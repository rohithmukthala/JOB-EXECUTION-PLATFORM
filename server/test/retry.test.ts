import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, resetDb } from "./helpers.js";
import { prisma } from "../src/db.js";

beforeEach(resetDb);

const reg = async () => (await request(app).post("/api/workers/register").send({ name: "w" })).body.id;

describe("retry + backoff", () => {
  it("retries with future availableAt, then marks dead at the ceiling", async () => {
    const w = await reg();
    const job = (await request(app).post("/api/jobs").send({ type: "x", maxAttempts: 2 })).body;

    // Attempt 1: claim then fail -> pending with backoff in the future.
    await request(app).post(`/api/workers/${w}/claim`);
    let res = await request(app).post(`/api/jobs/${job.id}/complete`).send({ status: "failed", error: "boom" });
    expect(res.body.status).toBe("pending");
    expect(new Date(res.body.availableAt).getTime()).toBeGreaterThan(Date.now());

    // Skip the wait: make it claimable now.
    await prisma.job.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });

    // Attempt 2: claim then fail -> attempts == maxAttempts -> dead.
    await request(app).post(`/api/workers/${w}/claim`);
    res = await request(app).post(`/api/jobs/${job.id}/complete`).send({ status: "failed", error: "boom2" });
    expect(res.body.status).toBe("dead");

    const detail = await request(app).get(`/api/jobs/${job.id}`);
    const types = detail.body.events.map((e: any) => e.type);
    expect(types).toContain("retried");
    expect(types).toContain("dead");
  });

  it("marks succeeded with result and progress 100", async () => {
    const w = await reg();
    const job = (await request(app).post("/api/jobs").send({ type: "x" })).body;
    await request(app).post(`/api/workers/${w}/claim`);
    const res = await request(app).post(`/api/jobs/${job.id}/complete`).send({ status: "succeeded", result: { ok: 1 } });
    expect(res.body.status).toBe("succeeded");
    expect(res.body.progress).toBe(100);
    expect(res.body.result).toEqual({ ok: 1 });
  });
});
