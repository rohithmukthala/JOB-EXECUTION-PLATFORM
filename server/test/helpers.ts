import { prisma } from "../src/db.js";
import { createApp } from "../src/app.js";

export const app = createApp();

// Wipe all rows between tests. Order respects FKs (events → jobs → workers).
export async function resetDb() {
  await prisma.jobEvent.deleteMany();
  await prisma.job.deleteMany();
  await prisma.worker.deleteMany();
}
