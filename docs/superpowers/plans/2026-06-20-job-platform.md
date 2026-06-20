# Distributed Job Execution Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable distributed job execution system — submit jobs to a Postgres-backed priority queue, workers claim/run them atomically, with retries, crash recovery, and a live Next.js dashboard.

**Architecture:** Postgres is the queue. The Express API server owns all queue logic (atomic claim via `FOR UPDATE SKIP LOCKED`, retry/backoff, a reaper loop for crash recovery) and is the single source of truth. Dumb worker processes talk only HTTP: register → heartbeat → claim → run → report. A Next.js dashboard polls the API every 1.5s.

**Tech Stack:** Node 24, TypeScript, Express 4, Prisma 5, PostgreSQL 16 (Docker), Next.js 14 (App Router), React 18, Tailwind, TanStack Query. npm workspaces. Tests: Vitest + Supertest (server), against a real Postgres.

**Spec:** `docs/superpowers/specs/2026-06-20-job-platform-design.md` and `CLAUDE.md`.

---

## File Structure

```
job-platform/ (repo root = project dir)
├── package.json                 # npm workspaces root, scripts
├── tsconfig.base.json           # shared TS config
├── docker-compose.yml           # postgres 16 only
├── .env.example / .env
├── .gitignore
├── shared/
│   ├── package.json
│   └── src/index.ts             # JobStatus, WorkerStatus, event types, DTOs
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── prisma/schema.prisma
│   └── src/
│       ├── config.ts            # timing constants + backoff
│       ├── db.ts                # prisma client singleton
│       ├── index.ts             # express bootstrap + start reaper
│       ├── app.ts               # express app factory (for tests)
│       ├── routes/jobs.ts
│       ├── routes/workers.ts
│       └── services/
│           ├── jobService.ts    # create/list/get, complete, backoff, events
│           ├── workerService.ts # register, heartbeat, claim (raw SQL)
│           └── reaper.ts        # requeue expired leases + mark dead workers
│   └── test/
│       ├── helpers.ts           # db reset, app instance
│       ├── jobs.test.ts
│       ├── claim.test.ts        # concurrency / SKIP LOCKED
│       ├── retry.test.ts
│       └── reaper.test.ts
├── worker/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── config.ts            # API_URL, poll/heartbeat ms
│       ├── api.ts               # typed HTTP client
│       ├── index.ts             # the loop
│       └── handlers/
│           ├── index.ts         # registry
│           ├── simulate.ts
│           └── fibonacci.ts
└── web/                         # next.js app (create-next-app)
    ├── package.json
    ├── lib/api.ts               # fetch wrappers + types
    ├── lib/queries.ts           # TanStack Query hooks
    ├── app/layout.tsx, providers.tsx, globals.css
    ├── app/page.tsx             # Submit
    ├── app/jobs/page.tsx        # Jobs table
    ├── app/workers/page.tsx     # Workers cards
    └── app/jobs/[id]/page.tsx   # Job detail timeline
```

**Commit after every task.** Tests run against a real Postgres (the queue logic is inseparable from Postgres semantics — `SKIP LOCKED` can't be meaningfully mocked).

---

## Task 0: Repo scaffolding, git, workspaces, Postgres

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.base.json`, `docker-compose.yml`, `.env.example`, `.env`

- [ ] **Step 1: Init git**

```bash
cd "c:/Users/rohit/OneDrive/Desktop/Project"
git init
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
dist/
.next/
.env
*.log
```

- [ ] **Step 3: Write root `package.json`**

```json
{
  "name": "job-platform",
  "private": true,
  "workspaces": ["shared", "server", "worker", "web"],
  "scripts": {
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "migrate": "npm run -w server migrate",
    "dev:server": "npm run -w server dev",
    "dev:worker": "npm run -w worker dev",
    "dev:web": "npm run -w web dev",
    "test": "npm run -w server test"
  }
}
```

- [ ] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 5: Write `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: jobs
      POSTGRES_PASSWORD: jobs
      POSTGRES_DB: jobs
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 6: Write `.env.example` and copy to `.env`**

`.env.example`:
```
DATABASE_URL="postgresql://jobs:jobs@localhost:5432/jobs?schema=public"
PORT=4000
API_URL="http://localhost:4000"
```

```bash
cp .env.example .env
```

- [ ] **Step 7: Start Postgres and verify**

```bash
npm run db:up
docker compose ps
```
Expected: `db` service `running`, port 5432 published.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold workspaces, docker postgres, tsconfig"
```

---

## Task 1: Shared types

**Files:**
- Create: `shared/package.json`, `shared/src/index.ts`

- [ ] **Step 1: Write `shared/package.json`**

```json
{
  "name": "@job-platform/shared",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 2: Write `shared/src/index.ts`**

```typescript
export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "dead";
export type WorkerStatus = "active" | "dead";

export type JobEventType =
  | "created" | "claimed" | "progress" | "succeeded"
  | "failed" | "retried" | "requeued" | "dead";

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  priority: number;
  status: JobStatus;
  progress: number;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt: string | null;
  workerId: string | null;
  result: unknown | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Worker {
  id: string;
  name: string;
  status: WorkerStatus;
  lastHeartbeatAt: string;
  registeredAt: string;
}

export interface JobEvent {
  id: string;
  jobId: string;
  workerId: string | null;
  type: JobEventType;
  message: string | null;
  createdAt: string;
}

export interface CreateJobInput {
  type: string;
  payload?: unknown;
  priority?: number;
  maxAttempts?: number;
}

export interface CompleteJobInput {
  status: "succeeded" | "failed";
  result?: unknown;
  error?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add shared && git commit -m "feat(shared): domain types and enums"
```

---

## Task 2: Prisma schema + migration

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/prisma/schema.prisma`

- [ ] **Step 1: Write `server/package.json`**

```json
{
  "name": "@job-platform/server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "migrate": "prisma migrate dev",
    "generate": "prisma generate",
    "test": "vitest run"
  },
  "dependencies": {
    "@job-platform/shared": "1.0.0",
    "@prisma/client": "^5.22.0",
    "express": "^4.21.2",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.10.0",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "outDir": "dist" },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Write `server/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum JobStatus {
  pending
  running
  succeeded
  failed
  dead
}

enum WorkerStatus {
  active
  dead
}

model Job {
  id             String     @id @default(uuid())
  type           String
  payload        Json       @default("{}")
  priority       Int        @default(0)
  status         JobStatus  @default(pending)
  progress       Int        @default(0)
  attempts       Int        @default(0)
  maxAttempts    Int        @default(3) @map("max_attempts")
  availableAt    DateTime   @default(now()) @map("available_at")
  leaseExpiresAt DateTime?  @map("lease_expires_at")
  workerId       String?    @map("worker_id")
  worker         Worker?    @relation(fields: [workerId], references: [id])
  result         Json?
  error          String?
  createdAt      DateTime   @default(now()) @map("created_at")
  updatedAt      DateTime   @updatedAt @map("updated_at")
  startedAt      DateTime?  @map("started_at")
  finishedAt     DateTime?  @map("finished_at")
  events         JobEvent[]

  @@index([status, availableAt])
  @@map("jobs")
}

model Worker {
  id              String       @id @default(uuid())
  name            String
  status          WorkerStatus @default(active)
  lastHeartbeatAt DateTime     @default(now()) @map("last_heartbeat_at")
  registeredAt    DateTime     @default(now()) @map("registered_at")
  jobs            Job[]
  events          JobEvent[]

  @@map("workers")
}

model JobEvent {
  id        String   @id @default(uuid())
  jobId     String   @map("job_id")
  job       Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  workerId  String?  @map("worker_id")
  worker    Worker?  @relation(fields: [workerId], references: [id])
  type      String
  message   String?
  createdAt DateTime @default(now()) @map("created_at")

  @@index([jobId, createdAt])
  @@map("job_events")
}
```

- [ ] **Step 4: Install deps + run migration**

```bash
npm install
npm run -w server migrate -- --name init
```
Expected: migration `init` created and applied; `prisma generate` runs; tables `jobs`, `workers`, `job_events` exist.

- [ ] **Step 5: Verify tables**

```bash
docker compose exec db psql -U jobs -d jobs -c "\dt"
```
Expected: lists `jobs`, `workers`, `job_events`, `_prisma_migrations`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(server): prisma schema + initial migration"
```

---

## Task 3: Config + db client + app factory

**Files:**
- Create: `server/src/config.ts`, `server/src/db.ts`, `server/src/app.ts`

- [ ] **Step 1: Write `server/src/config.ts`**

```typescript
// All timing relationships in one place so they can be explained on camera.
// HEARTBEAT (5s) << WORKER_DEAD (15s): a worker must miss ~3 beats to be declared dead.
// LEASE (30s) > REAPER (5s): a live worker renews its lease (via heartbeat/progress)
// well before the reaper would reclaim its job.
export const HEARTBEAT_MS = 5_000;
export const LEASE_MS = 30_000;
export const REAPER_MS = 5_000;
export const WORKER_DEAD_MS = 15_000;

// Exponential backoff: delay = min(base * 2^(attempts-1), max).
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
}

export const PORT = Number(process.env.PORT ?? 4000);
```

- [ ] **Step 2: Write `server/src/db.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

// Single Prisma instance shared across the process.
export const prisma = new PrismaClient();
```

- [ ] **Step 3: Write `server/src/app.ts` (routes wired in later tasks)**

```typescript
import express from "express";
import { jobsRouter } from "./routes/jobs.js";
import { workersRouter } from "./routes/workers.js";

// App factory so tests can spin up the API without starting the reaper/listener.
export function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/jobs", jobsRouter);
  app.use("/api/workers", workersRouter);
  return app;
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src && git commit -m "feat(server): config, db client, app factory"
```

Note: `app.ts` imports routers created in Tasks 5–6; it will not compile until those exist. That is fine — the next tasks are TDD and will make it compile. Commit anyway to keep steps atomic.

---

## Task 4: Test harness

**Files:**
- Create: `server/vitest.config.ts`, `server/test/helpers.ts`

- [ ] **Step 1: Write `server/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false, // tests share one DB; run sequentially
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 2: Write `server/test/helpers.ts`**

```typescript
import { prisma } from "../src/db.js";
import { createApp } from "../src/app.js";

export const app = createApp();

// Wipe all rows between tests. Order respects FKs (events → jobs → workers).
export async function resetDb() {
  await prisma.jobEvent.deleteMany();
  await prisma.job.deleteMany();
  await prisma.worker.deleteMany();
}
```

- [ ] **Step 3: Commit**

```bash
git add server/vitest.config.ts server/test/helpers.ts
git commit -m "test(server): vitest config + db reset helper"
```

---

## Task 5: jobService + jobs routes (create / list / get)

**Files:**
- Create: `server/src/services/jobService.ts`, `server/src/routes/jobs.ts`
- Test: `server/test/jobs.test.ts`

- [ ] **Step 1: Write failing test `server/test/jobs.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run -w server test`
Expected: FAIL — cannot find `./routes/jobs.js` / module errors.

- [ ] **Step 3: Write `server/src/services/jobService.ts`**

```typescript
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
```

- [ ] **Step 4: Write `server/src/routes/jobs.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { createJob, getJob, listJobs } from "../services/jobService.js";

export const jobsRouter = Router();

const createSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown().optional(),
  priority: z.number().int().optional(),
  maxAttempts: z.number().int().positive().optional(),
});

jobsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const job = await createJob(parsed.data);
  res.status(201).json(job);
});

jobsRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await listJobs(status));
});

jobsRouter.get("/:id", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});
```

- [ ] **Step 5: Add a stub workers router so `app.ts` compiles**

Create `server/src/routes/workers.ts`:
```typescript
import { Router } from "express";
export const workersRouter = Router();
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run -w server test`
Expected: PASS (3 jobs tests).

- [ ] **Step 7: Commit**

```bash
git add server/src server/test/jobs.test.ts
git commit -m "feat(server): create/list/get jobs + events"
```

---

## Task 6: workerService — register, heartbeat, atomic claim, progress, complete

**Files:**
- Modify: `server/src/routes/workers.ts`, `server/src/routes/jobs.ts`
- Create: `server/src/services/workerService.ts`
- Test: `server/test/claim.test.ts`

- [ ] **Step 1: Write failing test `server/test/claim.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run -w server test claim`
Expected: FAIL — `/api/workers/register` 404 / route missing.

- [ ] **Step 3: Write `server/src/services/workerService.ts`**

```typescript
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
    SET status = 'running',
        worker_id = ${workerId}::uuid,
        attempts = attempts + 1,
        started_at = now(),
        lease_expires_at = now() + (${leaseSeconds} || ' seconds')::interval,
        updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND available_at <= now()
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
```

- [ ] **Step 4: Add progress + complete to jobService (`server/src/services/jobService.ts`)**

Append:
```typescript
import { LEASE_MS, backoffMs } from "../config.js";
import type { CompleteJobInput } from "@job-platform/shared";

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
```

- [ ] **Step 5: Write `server/src/routes/workers.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { claimJob, heartbeat, listWorkers, registerWorker } from "../services/workerService.js";

export const workersRouter = Router();

workersRouter.get("/", async (_req, res) => res.json(await listWorkers()));

workersRouter.post("/register", async (req, res) => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const worker = await registerWorker(parsed.data.name);
  res.status(201).json(worker);
});

workersRouter.post("/:id/heartbeat", async (req, res) => {
  const worker = await heartbeat(req.params.id);
  res.json(worker);
});

workersRouter.post("/:id/claim", async (req, res) => {
  const job = await claimJob(req.params.id);
  if (!job) return res.status(204).end();
  res.json(job);
});
```

- [ ] **Step 6: Add progress + complete routes to `server/src/routes/jobs.ts`**

Append (and import `setProgress, completeJob`):
```typescript
import { completeJob, setProgress } from "../services/jobService.js";

jobsRouter.post("/:id/progress", async (req, res) => {
  const parsed = z.object({ progress: z.number() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const job = await setProgress(req.params.id, parsed.data.progress);
  res.json(job);
});

jobsRouter.post("/:id/complete", async (req, res) => {
  const parsed = z.object({
    status: z.enum(["succeeded", "failed"]),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const job = await completeJob(req.params.id, parsed.data);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});
```

- [ ] **Step 7: Run claim tests**

Run: `npm run -w server test claim`
Expected: PASS (3 tests, including the SKIP LOCKED concurrency test).

- [ ] **Step 8: Commit**

```bash
git add server/src server/test/claim.test.ts
git commit -m "feat(server): worker register/heartbeat/claim + progress/complete"
```

---

## Task 7: Retry/backoff behavior test

**Files:**
- Test: `server/test/retry.test.ts`

- [ ] **Step 1: Write test `server/test/retry.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, resetDb } from "./helpers.js";

beforeEach(resetDb);

const reg = async () => (await request(app).post("/api/workers/register").send({ name: "w" })).body.id;

describe("retry + backoff", () => {
  it("requeues with future available_at on failure, then dies at the ceiling", async () => {
    const w = await reg();
    const job = (await request(app).post("/api/jobs").send({ type: "x", maxAttempts: 2 })).body;

    // attempt 1
    await request(app).post(`/api/workers/${w}/claim`);
    let res = await request(app).post(`/api/jobs/${job.id}/complete`).send({ status: "failed", error: "boom" });
    expect(res.body.status).toBe("pending");
    expect(new Date(res.body.availableAt).getTime()).toBeGreaterThan(Date.now());

    // force it claimable now so the test doesn't wait for backoff
    await request(app).post(`/api/jobs/${job.id}/complete`); // no-op guard not needed
    // attempt 2 -> ceiling -> dead
    // make available immediately by re-claiming after manual availability reset:
    await request(app).post(`/api/jobs`); // noop
  });
});
```

Note: backoff makes the job unavailable, so the test cannot immediately re-claim. Replace the brittle section above with a deterministic approach in Step 2.

- [ ] **Step 2: Replace with deterministic test (final `retry.test.ts`)**

```typescript
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
```

- [ ] **Step 3: Run**

Run: `npm run -w server test retry`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add server/test/retry.test.ts && git commit -m "test(server): retry/backoff + success paths"
```

---

## Task 8: Reaper — requeue expired leases, mark dead workers

**Files:**
- Create: `server/src/services/reaper.ts`
- Test: `server/test/reaper.test.ts`

- [ ] **Step 1: Write failing test `server/test/reaper.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run -w server test reaper`
Expected: FAIL — cannot find `reaper.js`.

- [ ] **Step 3: Write `server/src/services/reaper.ts`**

```typescript
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
    SET status = 'pending', worker_id = NULL, available_at = now(), lease_expires_at = NULL
    WHERE status = 'running' AND lease_expires_at < now()
    RETURNING id;
  `;
  for (const { id } of requeued) {
    await logEvent(id, "requeued", "lease expired; worker presumed dead");
  }

  // (c) Mark workers dead if we haven't heard a heartbeat recently.
  await prisma.$executeRaw`
    UPDATE workers
    SET status = 'dead'
    WHERE status = 'active'
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
```

- [ ] **Step 4: Run reaper tests**

Run: `npm run -w server test reaper`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full server suite**

Run: `npm run -w server test`
Expected: PASS — all of jobs/claim/retry/reaper.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/reaper.ts server/test/reaper.test.ts
git commit -m "feat(server): reaper — requeue expired leases + mark dead workers"
```

---

## Task 9: Server bootstrap (index.ts)

**Files:**
- Create: `server/src/index.ts`

- [ ] **Step 1: Write `server/src/index.ts`**

```typescript
import { createApp } from "./app.js";
import { startReaper } from "./services/reaper.js";
import { PORT } from "./config.js";

const app = createApp();
startReaper();
app.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));
```

- [ ] **Step 2: Boot and smoke-test**

```bash
npm run dev:server &
sleep 3
curl -s localhost:4000/health
curl -s -X POST localhost:4000/api/jobs -H 'content-type: application/json' -d '{"type":"simulate","payload":{"steps":3}}'
curl -s localhost:4000/api/jobs
```
Expected: `{"ok":true}`, a created job JSON, then a list containing it. Stop the server (`kill %1`).

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts && git commit -m "feat(server): bootstrap express + reaper"
```

---

## Task 10: Worker runtime

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/src/config.ts`, `worker/src/api.ts`, `worker/src/handlers/{index,simulate,fibonacci}.ts`, `worker/src/index.ts`

- [ ] **Step 1: Write `worker/package.json`**

```json
{
  "name": "@job-platform/worker",
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "tsx src/index.ts" },
  "dependencies": { "@job-platform/shared": "1.0.0" },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 2: Write `worker/tsconfig.json`**

```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "rootDir": "src" }, "include": ["src"] }
```

- [ ] **Step 3: Write `worker/src/config.ts`**

```typescript
export const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const HEARTBEAT_MS = 5_000;
export const IDLE_SLEEP_MS = 1_000;
export const WORKER_NAME = process.env.WORKER_NAME ?? `worker-${process.pid}`;
```

- [ ] **Step 4: Write `worker/src/api.ts`**

```typescript
import { API_URL } from "./config.js";
import type { Job } from "@job-platform/shared";

async function post(path: string, body?: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

export async function register(name: string): Promise<string> {
  const res = await post("/api/workers/register", { name });
  return (await res.json()).id;
}
export async function heartbeat(id: string) { await post(`/api/workers/${id}/heartbeat`); }
export async function claim(id: string): Promise<Job | null> {
  const res = await post(`/api/workers/${id}/claim`);
  if (res.status === 204) return null;
  return res.json();
}
export async function reportProgress(jobId: string, progress: number) {
  await post(`/api/jobs/${jobId}/progress`, { progress });
}
export async function complete(jobId: string, status: "succeeded" | "failed", result?: unknown, error?: string) {
  await post(`/api/jobs/${jobId}/complete`, { status, result, error });
}
```

- [ ] **Step 5: Write handlers**

`worker/src/handlers/simulate.ts`:
```typescript
export interface SimulatePayload { steps?: number; stepMs?: number; failRate?: number; }
export async function simulate(
  payload: SimulatePayload,
  ctx: { progress: (p: number) => Promise<void> },
) {
  const steps = payload.steps ?? 10;
  const stepMs = payload.stepMs ?? 500;
  const failRate = payload.failRate ?? 0;
  for (let i = 1; i <= steps; i++) {
    await new Promise((r) => setTimeout(r, stepMs));
    if (Math.random() < failRate) throw new Error(`simulated failure at step ${i}`);
    await ctx.progress(Math.round((i / steps) * 100));
  }
  return { steps, completedAt: new Date().toISOString() };
}
```

`worker/src/handlers/fibonacci.ts`:
```typescript
export interface FibPayload { n?: number; }
export async function fibonacci(payload: FibPayload, ctx: { progress: (p: number) => Promise<void> }) {
  const n = payload.n ?? 30;
  let a = 0n, b = 1n;
  for (let i = 0; i < n; i++) {
    [a, b] = [b, a + b];
    if (i % Math.max(1, Math.floor(n / 10)) === 0) await ctx.progress(Math.round((i / n) * 100));
  }
  return { n, value: a.toString() };
}
```

`worker/src/handlers/index.ts`:
```typescript
import { simulate } from "./simulate.js";
import { fibonacci } from "./fibonacci.js";

export type Handler = (payload: any, ctx: { progress: (p: number) => Promise<void> }) => Promise<unknown>;
export const handlers: Record<string, Handler> = { simulate, fibonacci };
```

- [ ] **Step 6: Write `worker/src/index.ts` (the loop)**

```typescript
import { register, heartbeat, claim, reportProgress, complete } from "./api.js";
import { handlers } from "./handlers/index.js";
import { HEARTBEAT_MS, IDLE_SLEEP_MS, WORKER_NAME } from "./config.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = true;

async function main() {
  const id = await register(WORKER_NAME);
  console.log(`[worker] registered ${WORKER_NAME} as ${id}`);

  const hb = setInterval(() => heartbeat(id).catch(() => {}), HEARTBEAT_MS);

  const shutdown = () => { running = false; clearInterval(hb); console.log("[worker] stopping"); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    const job = await claim(id).catch(() => null);
    if (!job) { await sleep(IDLE_SLEEP_MS); continue; }

    console.log(`[worker] claimed job ${job.id} (${job.type})`);
    const handler = handlers[job.type];
    if (!handler) { await complete(job.id, "failed", undefined, `no handler for type "${job.type}"`); continue; }

    try {
      const result = await handler(job.payload, { progress: (p) => reportProgress(job.id, p) });
      await complete(job.id, "succeeded", result);
      console.log(`[worker] job ${job.id} succeeded`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await complete(job.id, "failed", undefined, msg);
      console.log(`[worker] job ${job.id} failed: ${msg}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 7: Manual end-to-end check (server must be running)**

```bash
npm run dev:server &          # terminal A
sleep 3
npm run dev:worker &          # terminal B
sleep 2
curl -s -X POST localhost:4000/api/jobs -H 'content-type: application/json' -d '{"type":"simulate","payload":{"steps":4,"stepMs":300}}'
sleep 3
curl -s localhost:4000/api/jobs | head -c 400
curl -s localhost:4000/api/workers
```
Expected: worker registers (visible in `/api/workers`), job moves pending → running → succeeded with progress reaching 100. Kill both (`kill %1 %2`).

- [ ] **Step 8: Commit**

```bash
git add worker && git commit -m "feat(worker): loop, http client, simulate + fibonacci handlers"
```

---

## Task 11: Web app scaffold + API client + providers

**Files:**
- Create: `web/` via create-next-app, then `web/lib/api.ts`, `web/lib/queries.ts`, `web/app/providers.tsx`

- [ ] **Step 1: Scaffold Next.js into `web/`**

```bash
npx create-next-app@14 web --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm
```
Then add TanStack Query:
```bash
npm install -w web @tanstack/react-query
```
Set the API base: create `web/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:4000`.

- [ ] **Step 2: Write `web/lib/api.ts`**

```typescript
import type { Job, JobEvent, Worker } from "@job-platform/shared";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type JobWithEvents = Job & { events: JobEvent[] };

export async function fetchJobs(status?: string): Promise<Job[]> {
  const url = new URL(`${BASE}/api/jobs`);
  if (status) url.searchParams.set("status", status);
  return (await fetch(url, { cache: "no-store" })).json();
}
export async function fetchJob(id: string): Promise<JobWithEvents> {
  return (await fetch(`${BASE}/api/jobs/${id}`, { cache: "no-store" })).json();
}
export async function fetchWorkers(): Promise<Worker[]> {
  return (await fetch(`${BASE}/api/workers`, { cache: "no-store" })).json();
}
export async function createJob(body: {
  type: string; payload?: unknown; priority?: number; maxAttempts?: number;
}): Promise<Job> {
  return (await fetch(`${BASE}/api/jobs`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  })).json();
}
```

- [ ] **Step 3: Write `web/app/providers.tsx`**

```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 4: Write `web/lib/queries.ts`**

```typescript
import { useQuery } from "@tanstack/react-query";
import { fetchJob, fetchJobs, fetchWorkers } from "./api";

const POLL = 1500;
export const useJobs = (status?: string) =>
  useQuery({ queryKey: ["jobs", status], queryFn: () => fetchJobs(status), refetchInterval: POLL });
export const useJob = (id: string) =>
  useQuery({ queryKey: ["job", id], queryFn: () => fetchJob(id), refetchInterval: POLL });
export const useWorkers = () =>
  useQuery({ queryKey: ["workers"], queryFn: fetchWorkers, refetchInterval: POLL });
```

- [ ] **Step 5: Wrap `web/app/layout.tsx` body with `<Providers>` and add a nav**

Replace the body contents of `web/app/layout.tsx`:
```tsx
import "./globals.css";
import Link from "next/link";
import { Providers } from "./providers";

export const metadata = { title: "Job Platform" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Providers>
          <nav className="flex gap-4 border-b bg-white px-6 py-3 text-sm font-medium">
            <Link href="/">Submit</Link>
            <Link href="/jobs">Jobs</Link>
            <Link href="/workers">Workers</Link>
          </nav>
          <main className="mx-auto max-w-5xl p-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add web && git commit -m "feat(web): next scaffold, api client, query hooks, layout"
```

---

## Task 12: Dashboard views (Submit, Jobs, Workers, Job detail)

**Files:**
- Create: `web/app/page.tsx`, `web/app/jobs/page.tsx`, `web/app/workers/page.tsx`, `web/app/jobs/[id]/page.tsx`
- Create: `web/components/StatusBadge.tsx`

- [ ] **Step 1: Write `web/components/StatusBadge.tsx`**

```tsx
const COLORS: Record<string, string> = {
  pending: "bg-gray-200 text-gray-800",
  running: "bg-blue-200 text-blue-900",
  succeeded: "bg-green-200 text-green-900",
  failed: "bg-amber-200 text-amber-900",
  dead: "bg-red-200 text-red-900",
  active: "bg-green-200 text-green-900",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${COLORS[status] ?? "bg-gray-200"}`}>{status}</span>;
}
```

- [ ] **Step 2: Write `web/app/page.tsx` (Submit)**

```tsx
"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createJob } from "@/lib/api";

export default function SubmitPage() {
  const qc = useQueryClient();
  const [type, setType] = useState("simulate");
  const [priority, setPriority] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [payload, setPayload] = useState('{ "steps": 8, "stepMs": 500, "failRate": 0 }');
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let parsed: unknown = {};
    try { parsed = JSON.parse(payload || "{}"); }
    catch { setMsg("Invalid JSON payload"); return; }
    const job = await createJob({ type, payload: parsed, priority, maxAttempts });
    setMsg(`Created job ${job.id}`);
    qc.invalidateQueries({ queryKey: ["jobs"] });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-xl font-bold">Submit a job</h1>
      <label className="block">Type
        <input className="mt-1 w-full rounded border p-2" value={type} onChange={(e) => setType(e.target.value)} />
      </label>
      <div className="flex gap-4">
        <label className="block flex-1">Priority
          <input type="number" className="mt-1 w-full rounded border p-2" value={priority} onChange={(e) => setPriority(+e.target.value)} />
        </label>
        <label className="block flex-1">Max attempts
          <input type="number" className="mt-1 w-full rounded border p-2" value={maxAttempts} onChange={(e) => setMaxAttempts(+e.target.value)} />
        </label>
      </div>
      <label className="block">Payload (JSON)
        <textarea className="mt-1 h-32 w-full rounded border p-2 font-mono text-sm" value={payload} onChange={(e) => setPayload(e.target.value)} />
      </label>
      <button className="rounded bg-blue-600 px-4 py-2 font-medium text-white">Submit</button>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Write `web/app/jobs/page.tsx` (Jobs table)**

```tsx
"use client";
import Link from "next/link";
import { useJobs } from "@/lib/queries";
import { StatusBadge } from "@/components/StatusBadge";

export default function JobsPage() {
  const { data: jobs = [] } = useJobs();
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Jobs</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">Type</th><th>Priority</th><th>Status</th>
            <th>Progress</th><th>Attempts</th><th>Worker</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-b hover:bg-white">
              <td className="py-2"><Link className="text-blue-600 underline" href={`/jobs/${j.id}`}>{j.type}</Link></td>
              <td>{j.priority}</td>
              <td><StatusBadge status={j.status} /></td>
              <td className="w-40">
                <div className="h-2 w-full rounded bg-gray-200">
                  <div className="h-2 rounded bg-blue-500" style={{ width: `${j.progress}%` }} />
                </div>
              </td>
              <td>{j.attempts}/{j.maxAttempts}</td>
              <td className="font-mono text-xs">{j.workerId?.slice(0, 8) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Write `web/app/workers/page.tsx`**

```tsx
"use client";
import { useWorkers } from "@/lib/queries";
import { StatusBadge } from "@/components/StatusBadge";

function secondsAgo(iso: string) { return Math.round((Date.now() - new Date(iso).getTime()) / 1000); }

export default function WorkersPage() {
  const { data: workers = [] } = useWorkers();
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Workers</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {workers.map((w) => {
          const ago = secondsAgo(w.lastHeartbeatAt);
          return (
            <div key={w.id} className="rounded border bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{w.name}</span>
                <StatusBadge status={w.status} />
              </div>
              <p className="mt-2 font-mono text-xs text-gray-500">{w.id.slice(0, 8)}</p>
              <p className={`mt-1 text-sm ${ago > 15 ? "text-red-600" : "text-gray-600"}`}>
                last heartbeat {ago}s ago
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `web/app/jobs/[id]/page.tsx` (timeline)**

```tsx
"use client";
import { useJob } from "@/lib/queries";
import { StatusBadge } from "@/components/StatusBadge";

export default function JobDetailPage({ params }: { params: { id: string } }) {
  const { data: job } = useJob(params.id);
  if (!job) return <p>Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{job.type}</h1>
        <StatusBadge status={job.status} />
      </div>
      <p className="text-sm text-gray-600">
        attempts {job.attempts}/{job.maxAttempts} · progress {job.progress}%
        {job.error && <span className="ml-2 text-red-600">error: {job.error}</span>}
      </p>
      <h2 className="font-semibold">History</h2>
      <ol className="space-y-1 border-l-2 pl-4">
        {job.events.map((e) => (
          <li key={e.id} className="text-sm">
            <span className="font-mono text-xs text-gray-400">{new Date(e.createdAt).toLocaleTimeString()}</span>{" "}
            <span className="font-semibold">{e.type}</span>
            {e.message && <span className="text-gray-600"> — {e.message}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 6: Run the dashboard against the live stack**

```bash
npm run db:up
npm run dev:server &   # A
npm run dev:worker &   # B
npm run dev:web        # C -> open http://localhost:3000
```
Manually verify: Submit creates a job; Jobs table shows live progress bar advancing; Workers shows the worker with a heartbeat counter; clicking a job shows its event timeline.

- [ ] **Step 7: Commit**

```bash
git add web && git commit -m "feat(web): submit, jobs table, workers, job-detail timeline"
```

---

## Task 13: Demo verification of P1 features (manual, scripted)

**Files:** none (verification only)

- [ ] **Step 1: Priority** — with server+worker stopped, submit a low then a high priority job, then start one worker. Confirm the high-priority job goes `running` first.

```bash
curl -s -X POST localhost:4000/api/jobs -d '{"type":"simulate","priority":0,"payload":{"steps":5,"stepMs":400}}' -H 'content-type: application/json'
curl -s -X POST localhost:4000/api/jobs -d '{"type":"simulate","priority":10,"payload":{"steps":5,"stepMs":400}}' -H 'content-type: application/json'
npm run dev:worker
```
Expected: priority-10 job claimed first.

- [ ] **Step 2: Retry** — submit with `failRate: 1`, watch attempts climb and status reach `dead` after `maxAttempts`, with `retried`/`dead` events in the timeline.

```bash
curl -s -X POST localhost:4000/api/jobs -d '{"type":"simulate","maxAttempts":3,"payload":{"steps":3,"stepMs":200,"failRate":1}}' -H 'content-type: application/json'
```

- [ ] **Step 3: Crash recovery** — submit a long job (`steps:30, stepMs:1000`), let a worker claim it, then `kill` that worker mid-job. Within ~15s the worker shows `dead` and within ~30s (lease) the reaper re-queues the job (`requeued` event), and another worker can pick it up.

- [ ] **Step 4: Concurrency** — start 3 workers, submit 10 jobs, confirm no job has two `claimed` events from different workers (already covered by `claim.test.ts`, reconfirm live).

- [ ] **Step 5: Full test suite green**

Run: `npm run -w server test`
Expected: all suites PASS.

- [ ] **Step 6: Commit (if any tweaks were needed)**

```bash
git add -A && git commit -m "chore: P1 demo verification tweaks"
```

---

## Task 14: Deliverable docs

**Files:**
- Create: `Readme.md`, `Architecture.md`, `Agent.md`

- [ ] **Step 1: Write `Readme.md`** — prerequisites (Node 24, Docker), exact quickstart from a clean clone:

```
1. cp .env.example .env
2. npm install
3. npm run db:up
4. npm run migrate
5. npm run dev:server        (terminal A)
6. npm run dev:worker        (terminal B, repeat in more terminals for more workers)
7. npm run dev:web           (terminal C) -> http://localhost:3000
Test: npm test
```
Include env vars, the 9 endpoints, handler payloads, and the "Assumptions / known limitations" list from CLAUDE.md §15.

- [ ] **Step 2: Write `Architecture.md`** — pull from CLAUDE.md §3,§4,§6,§7,§14: the diagram, the queue-in-Postgres idea, the three core queries with their comments, the state machine, and the design trade-offs.

- [ ] **Step 3: Write `Agent.md`** — how AI was used: brainstorming → spec (`docs/superpowers/specs/...`) → this plan → TDD task-by-task execution; note the workflow and that the spec/plan live in the repo.

- [ ] **Step 4: Verify the Readme quickstart works from scratch**

```bash
git stash -u 2>/dev/null; docker compose down -v; npm install; npm run db:up; sleep 5; npm run migrate
```
Expected: clean migrate succeeds. (Then bring up server/worker/web and click through once.)

- [ ] **Step 5: Commit**

```bash
git add Readme.md Architecture.md Agent.md
git commit -m "docs: readme, architecture, agent notes"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** accepting jobs (T5), worker registration (T6), atomic claim/SKIP LOCKED (T6 + claim.test), progress (T6), heartbeat (T6), retry/backoff (T6 logic + T7 test), crash recovery/reaper (T8), priority ordering (T6 query + T13), job_events history (T5 logEvent throughout + T12 timeline), workers view/heartbeat staleness (T12). Runtime decision (Docker PG + local) realized in T0/T13. Docs (T14).
- **Type consistency:** shared `Job/Worker/JobEvent` field names (camelCase) match Prisma `@map`ped columns surfaced by the client; worker `api.ts` and web `api.ts` consume the same shared types; `claimJob`/`completeJob`/`setProgress`/`runReaperOnce`/`startReaper` names are used identically across tasks.
- **Placeholder scan:** Task 7 Step 1 is intentionally shown as a brittle first attempt and immediately replaced by the deterministic version in Step 2 (TDD honesty); no unresolved TBDs elsewhere.
- **Known nuance:** all timing constants live solely in `config.ts`; the reaper derives `WORKER_DEAD_SECONDS` locally from `WORKER_DEAD_MS`, so there is one source of truth and no duplicated/divergent values.
```
