import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, resetDb } from "./helpers.js";
import { prisma } from "../src/db.js";
import { runReaperOnce } from "../src/services/reaper.js";

beforeEach(resetDb);

const reg = async (name = "w") => (await request(app).post("/api/workers/register").send({ name })).body.id;

describe("reaper", () => {
  it("requeues a running job whose lease has expired", async () => {
    const w = await reg();
    const job = (await request(app).post("/api/jobs").send({ type: "x" })).body;
    await request(app).post(`/api/workers/${w}/claim`); // running, leased
    // Force the lease into the past.
    await prisma.job.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });

    await runReaperOnce();

    const detail = await request(app).get(`/api/jobs/${job.id}`);
    expect(detail.body.status).toBe("pending");
    expect(detail.body.workerId).toBeNull();
    expect(detail.body.events.map((e: any) => e.type)).toContain("requeued");
  });

  it("marks a worker dead when its last heartbeat is stale", async () => {
    const w = await reg();
    await prisma.worker.update({ where: { id: w }, data: { lastHeartbeatAt: new Date(0) } });
    await runReaperOnce();
    const workers = (await request(app).get("/api/workers")).body;
    expect(workers.find((x: any) => x.id === w).status).toBe("dead");
  });
});
