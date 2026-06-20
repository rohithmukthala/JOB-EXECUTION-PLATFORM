import { prisma } from "../db.js";
import { LEASE_MS } from "../config.js";
import { logEvent } from "./jobService.js";

export async function registerWorker(name: string) {
  return prisma.worker.create({ data: { name } });
}

// Heartbeat refreshes the worker AND renews the lease of any job it is running,
// so a healthy worker's job is never reaped mid-flight.
export async function heartbeat(workerId: string) {
  const worker = await prisma.worker.update({
    where: { id: workerId },
    data: { lastHeartbeatAt: new Date(), status: "active" },
  });
  await prisma.job.updateMany({
    where: { workerId, status: "running" },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  return worker;
}

/**
 * Atomic claim — the heart of the scheduler.
 * The inner SELECT picks the highest-priority claimable row and locks it with
 * FOR UPDATE SKIP LOCKED, so concurrent workers each grab a *different* row and
 * two workers can never claim the same job. attempts++ and the lease are set in
 * the same statement/transaction as the status flip to 'running'.
 */
export async function claimJob(workerId: string) {
  const leaseSeconds = Math.floor(LEASE_MS / 1000);
  const rows = await prisma.$queryRaw<any[]>`
    UPDATE jobs
    SET status = 'running'::"JobStatus",
        worker_id = ${workerId}::uuid,
        attempts = attempts + 1,
        started_at = now(),
        lease_expires_at = now() + (${leaseSeconds} || ' seconds')::interval,
        updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending'::"JobStatus" AND available_at <= now()
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `;
  const row = rows[0];
  if (!row) return null;
  await logEvent(row.id, "claimed", `attempt ${row.attempts}`, workerId);
  return prisma.job.findUnique({ where: { id: row.id } });
}

export async function listWorkers() {
  return prisma.worker.findMany({ orderBy: { registeredAt: "asc" } });
}
