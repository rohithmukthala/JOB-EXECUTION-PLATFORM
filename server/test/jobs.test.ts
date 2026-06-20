import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, resetDb } from "./helpers.js";

beforeEach(resetDb);

describe("jobs API", () => {
  it("creates a pending job and logs a 'created' event", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send({ type: "simulate", payload: { steps: 3 }, priority: 5 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.priority).toBe(5);

    const detail = await request(app).get(`/api/jobs/${res.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.events.map((e: any) => e.type)).toContain("created");
  });

  it("rejects a job with no type", async () => {
    const res = await request(app).post("/api/jobs").send({ payload: {} });
    expect(res.status).toBe(400);
  });

  it("lists jobs newest first, filterable by status", async () => {
    await request(app).post("/api/jobs").send({ type: "a" });
    await request(app).post("/api/jobs").send({ type: "b" });
    const res = await request(app).get("/api/jobs");
    expect(res.body.length).toBe(2);
    expect(res.body[0].type).toBe("b"); // newest first

    const filtered = await request(app).get("/api/jobs?status=succeeded");
    expect(filtered.body.length).toBe(0);
  });
});
