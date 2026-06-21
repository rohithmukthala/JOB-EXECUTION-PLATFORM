# Distributed Job Execution Platform

Submit computational jobs to a Postgres-backed priority queue. Independent worker
processes register, claim jobs atomically, run them, report progress, and complete or
fail them. The system retries failed jobs with exponential backoff, detects crashed
workers via heartbeats, and re-queues any job a dead worker was holding. A Next.js
dashboard shows live status and full per-job history.

## Architecture in one line

The queue lives **inside Postgres**. Assigning a job is an atomic `UPDATE` that claims the
highest-priority unlocked `pending` row using `FOR UPDATE SKIP LOCKED` — so two workers can
never grab the same job, with no separate message broker. See `Architecture.md` for the
full picture and design trade-offs.

## Prerequisites

- **Node 24** (uses global `fetch`)
- **Docker Desktop** (for Postgres 16)
- npm 11 (ships with Node 24)

## Quickstart (from a clean clone)

```bash
# 1. Configure env
cp .env.example .env

# 2. Install all workspace deps (shared, server, worker, web)
npm install

# 3. Start Postgres (Docker)
npm run db:up

# 4. Create the schema
npm run migrate

# 5. Start the API server          (terminal A)  -> http://localhost:4000
npm run dev:server

# 6. Start a worker                 (terminal B)
npm run dev:worker
#    Start more workers in more terminals (each gets a distinct name automatically):
#    WORKER_NAME=w2 npm run dev:worker

# 7. Start the dashboard            (terminal C)  -> http://localhost:3000
npm run dev:web
```

Open http://localhost:3000, submit a job, and watch it run.

## Run the tests

```bash
npm test          # server test suite (Vitest, against the running Postgres) — 10 tests
```

The tests run against the real Postgres on `localhost:5432` (queue semantics like
`SKIP LOCKED` can't be meaningfully mocked), so make sure `npm run db:up` has run first.

## Environment variables (`.env`)

| var            | default                                                      | used by        |
|----------------|--------------------------------------------------------------|----------------|
| `DATABASE_URL` | `postgresql://jobs:jobs@localhost:5432/jobs?schema=public`   | server (Prisma)|
| `PORT`         | `4000`                                                       | server         |
| `API_URL`      | `http://localhost:4000`                                      | worker         |

The web app reads `NEXT_PUBLIC_API_URL` from `web/.env.local` (defaults to
`http://localhost:4000`).

## API

User-facing (used by the dashboard):

| method | path                | body / query                                  |
|--------|---------------------|-----------------------------------------------|
| POST   | `/api/jobs`         | `{ type, payload?, priority?, maxAttempts? }` |
| GET    | `/api/jobs`         | `?status=` (optional filter)                  |
| GET    | `/api/jobs/:id`     | — returns the job plus its `job_events`       |
| GET    | `/api/workers`      | — list workers with health                    |

Worker-facing:

| method | path                          | body                                          |
|--------|-------------------------------|-----------------------------------------------|
| POST   | `/api/workers/register`       | `{ name }` → `{ id, ... }`                     |
| POST   | `/api/workers/:id/heartbeat`  | — refreshes health + renews its job's lease   |
| POST   | `/api/workers/:id/claim`      | — atomic claim; returns a job or `204`        |
| POST   | `/api/jobs/:id/progress`      | `{ progress }` (0–100; also renews lease)     |
| POST   | `/api/jobs/:id/complete`      | `{ status: 'succeeded'\|'failed', result?, error? }` |

## Job handlers

Workers run a job by looking up a handler by its `type`:

- **`simulate`** — payload `{ steps, stepMs, failRate }`. Loops `steps` times, sleeps
  `stepMs` each, reports progress, and throws with probability `failRate`. One handler that
  demonstrates progress bars, retries (`failRate: 1`), long jobs, and crash recovery.
- **`fibonacci`** — payload `{ n }`. Computes the n-th Fibonacci number (BigInt) and reports
  progress. Example: `{ "type": "fibonacci", "payload": { "n": 20 } }` → `value: "6765"`.

## Try the demo scenarios

- **Priority:** submit a `priority: 0` and a `priority: 10` job before starting a worker;
  the high-priority one runs first.
- **Retry → dead:** submit `simulate` with `{ "failRate": 1 }` and `maxAttempts: 3`; watch
  attempts climb (backoff 2s, 4s) and the job end as `dead` in its timeline.
- **Crash recovery:** submit a long job (`{ "steps": 30, "stepMs": 1000 }`), let a worker
  claim it, then kill that worker. Within ~15s it shows `dead`; within ~30s the reaper logs a
  `requeued` event and another worker finishes it.

## Project layout

```
shared/   shared TS types + enums (Job, Worker, JobEvent, statuses)
server/   Express API + Prisma + reaper loop (the single source of truth)
worker/   the claim/run/report loop + job handlers
web/      Next.js dashboard (Submit, Jobs, Workers, Job detail)
docs/     design spec + implementation plan
```

## Assumptions & known limitations (deliberate scope cuts)

- **No auth** — out of scope for the assessment.
- **Single API server is a SPOF.** In production you'd run several behind a load balancer;
  the Postgres-backed claim query already supports that (they'd share it safely).
- **Polling, not push.** The dashboard polls every 1.5s — simple and stateless; SSE/WebSockets
  would be the upgrade for instant updates.
- **At-least-once delivery.** A worker that stalls (but isn't truly dead) could have its job
  re-run after the lease expires, so **handlers should be idempotent**. This is the standard
  distributed-systems trade-off (same model as SQS visibility timeouts).
- **No per-worker concurrency limit** — one job at a time per worker.

These are intentional choices to ship a correct, well-understood core in the available time.
```
