import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, resetDb } from "./helpers.js";

beforeEach(resetDb);

async function register(name: string) {
  const res = await request(app).post("/api/workers/register").send({ name });
  return res.body.id as string;
}
async function submit(body: object) {
  return (await request(app).post("/api/jobs").send(body)).body;
}

describe("claim", () => {
  it("claims highest priority first, sets running + lease + attempts", async () => {
    await submit({ type: "a", priority: 0 });
    const high = await submit({ type: "b", priority: 10 });
    const w = await register("w1");

    const res = await request(app).post(`/api/workers/${w}/claim`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(high.id);
    expect(res.body.status).toBe("running");
    expect(res.body.attempts).toBe(1);
    expect(res.body.workerId).toBe(w);
    expect(res.body.leaseExpiresAt).toBeTruthy();
  });

  it("returns 204 when no work is available", async () => {
    const w = await register("w1");
    const res = await request(app).post(`/api/workers/${w}/claim`);
    expect(res.status).toBe(204);
  });

  it("never hands the same job to two workers (SKIP LOCKED)", async () => {
    const job = await submit({ type: "a" });
    const [w1, w2] = await Promise.all([register("w1"), register("w2")]);
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/workers/${w1}/claim`),
      request(app).post(`/api/workers/${w2}/claim`),
    ]);
    const claimedIds = [r1.body?.id, r2.body?.id].filter(Boolean);
    expect(claimedIds).toEqual([job.id]); // exactly one claim
  });
});
