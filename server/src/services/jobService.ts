import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import type { CreateJobInput, JobEventType, CompleteJobInput } from "@job-platform/shared";
import { LEASE_MS, backoffMs } from "../config.js";

export async function logEvent(
  jobId: string,
  type: JobEventType,
  message?: string,
  workerId?: string | null,
) {
  await prisma.jobEvent.create({
    data: { jobId, type, message: message ?? null, workerId: workerId ?? null },
  });
}

export async function createJob(input: CreateJobInput) {
  const job = await prisma.job.create({
    data: {
      type: input.type,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 3,
    },
  });
  await logEvent(job.id, "created", `priority=${job.priority}`);
  return job;
}

export async function listJobs(status?: string) {
  return prisma.job.findMany({
    where: status ? { status: status as any } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function getJob(id: string) {
  return prisma.job.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
}

// Worker reports progress; this also renews the lease (the job is alive).
export async function setProgress(jobId: string, progress: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  const job = await prisma.job.update({
    where: { id: jobId },
    data: { progress: clamped, leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  await logEvent(jobId, "progress", `${clamped}%`, job.workerId);
  return job;
}

// Terminal report from a worker. On failure we either retry with backoff
// (status back to pending, available_at in the future) or mark the job dead
// once attempts have hit the ceiling.
export async function completeJob(jobId: string, input: CompleteJobInput) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;

  if (input.status === "succeeded") {
    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        progress: 100,
        result: (input.result ?? {}) as Prisma.InputJsonValue,
        finishedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
    await logEvent(jobId, "succeeded", undefined, job.workerId);
    return updated;
  }

  await logEvent(jobId, "failed", input.error ?? "failed", job.workerId);
  if (job.attempts < job.maxAttempts) {
    const delay = backoffMs(job.attempts);
    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "pending",
        workerId: null,
        leaseExpiresAt: null,
        error: input.error ?? null,
        availableAt: new Date(Date.now() + delay),
      },
    });
    await logEvent(jobId, "retried", `retry in ${delay}ms (attempt ${job.attempts}/${job.maxAttempts})`);
    return updated;
  }

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: { status: "dead", error: input.error ?? null, finishedAt: new Date(), leaseExpiresAt: null },
  });
  await logEvent(jobId, "dead", `gave up after ${job.attempts} attempts`);
  return updated;
}
