import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import type { CreateJobInput, JobEventType } from "@job-platform/shared";

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
