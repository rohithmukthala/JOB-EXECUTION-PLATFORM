import { prisma } from "../db.js";
import { REAPER_MS, WORKER_DEAD_MS } from "../config.js";
import { logEvent } from "./jobService.js";

const WORKER_DEAD_SECONDS = Math.floor(WORKER_DEAD_MS / 1000);

// One reaper pass. Exported separately so tests can run it deterministically.
export async function runReaperOnce() {
  // (b) Re-queue jobs whose worker's lease expired — the crash-recovery core.
  // A live worker renews its lease via heartbeat/progress; a dead one cannot,
  // so its in-flight job becomes claimable again. (SQS "visibility timeout".)
  const requeued = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE jobs
    SET status = 'pending'::"JobStatus", worker_id = NULL, available_at = now(), lease_expires_at = NULL
    WHERE status = 'running'::"JobStatus" AND lease_expires_at < now()
    RETURNING id;
  `;
  for (const { id } of requeued) {
    await logEvent(id, "requeued", "lease expired; worker presumed dead");
  }

  // (c) Mark workers dead if we haven't heard a heartbeat recently.
  await prisma.$executeRaw`
    UPDATE workers
    SET status = 'dead'::"WorkerStatus"
    WHERE status = 'active'::"WorkerStatus"
      AND last_heartbeat_at < now() - (${WORKER_DEAD_SECONDS} || ' seconds')::interval;
  `;

  return requeued.length;
}

let timer: NodeJS.Timeout | null = null;
export function startReaper() {
  if (timer) return;
  timer = setInterval(() => {
    runReaperOnce().catch((e) => console.error("[reaper] error", e));
  }, REAPER_MS);
  console.log(`[reaper] started (every ${REAPER_MS}ms)`);
}
