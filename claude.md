# CLAUDE.md — Distributed Job Execution Platform

> This file is the single source of truth for building this project.
> It is written to be dropped into the repo root and used with Claude Code,
> AND to be read by a human who needs to *understand and explain* every decision.
> Read the "Design decisions & trade-offs" section before recording any demo —
> the reviewers grade understanding, not line count.

---

## 1. What we are building (in one paragraph)

A **Distributed Job Execution System**. Users submit computational jobs through a web
dashboard. Jobs land in a priority queue. Independent **worker** processes register
themselves, pull jobs from the queue, run them, and report progress and results back.
The system retries failed jobs, detects crashed workers via heartbeats, and re-queues
any job that a dead worker was holding. Every state change is recorded so the dashboard
can show live status and full execution history.

The whole thing should be runnable on a laptop with: one Postgres database, one API
server, one or more worker processes, and one Next.js web app.

---

## 2. How this maps to what the reviewers asked for

Every required feature must map to something visible in the demo. Keep this table honest.

| Required feature              | Where it lives in our system                                              |
|-------------------------------|---------------------------------------------------------------------------|
| Accepting jobs                | `POST /api/jobs` → row inserted with status `pending`                     |
| Worker registration           | `POST /api/workers/register` → row in `workers`                          |
| Job scheduling / assignment    | Atomic "claim" query using `FOR UPDATE SKIP LOCKED`                       |
| Execution monitoring/progress  | Worker posts progress 0–100; stored on the job; UI polls it              |
| Heartbeat monitoring           | Worker posts heartbeat every 5s; server tracks `last_heartbeat_at`       |
| Retry policies                 | On failure: re-queue with exponential backoff until `max_attempts`        |
| Failure recovery (crashes)     | Reaper re-queues jobs whose worker's lease expired                        |
| Queue prioritization           | `ORDER BY priority DESC, created_at ASC` in the claim query               |
| Storing execution history      | `job_events` append-only audit table                                     |

If you run out of time, the **P0 + P1** items below are the assignment. P2 is bonus.

---

## 3. Tech stack (and *why* — memorize these reasons)

- **Backend: Node.js + TypeScript + Express.** Express because it is the most widely
  understood Node framework, so the code reads clearly and is easy to explain. TypeScript
  so the job/worker state machine is typed and mistakes get caught at compile time.
- **Database: PostgreSQL.** This is the most important decision. Postgres lets us use the
  database itself as the job queue via `SELECT ... FOR UPDATE SKIP LOCKED`. That single
  feature gives us **atomic job assignment** (two workers can never grab the same job)
  without needing a separate message broker like RabbitMQ or Redis. It is ACID, so
  "claim a job" and "increment its attempt count" happen in one transaction. For an
  assessment, one dependency that we fully understand beats three we half understand.
- **ORM: Prisma** for schema, migrations, and ordinary reads/writes (clear and fast to
  build), plus **one raw SQL query** (`$queryRaw`) for the atomic claim, because that needs
  `SKIP LOCKED` which the ORM can't express. Call this out in the demo — it shows you know
  where the abstraction stops.
- **Frontend: Next.js (App Router) + React + TypeScript + Tailwind.** TanStack Query for
  polling the API every ~1.5s. Polling, not WebSockets, on purpose (see trade-offs).
- **Workers are plain Node processes that talk to the API over HTTP.** They do NOT touch
  the database directly. The server owns all queue logic and is the single source of truth.
  This keeps workers dumb, makes the system genuinely distributed, and means you can start
  five workers in five terminals with no extra config.

---

## 4. Architecture overview

```
            ┌─────────────────────────────────────────────┐
            │              Web Dashboard (Next.js)         │
            │  submit jobs · view queue · workers · history│
            └───────────────────┬─────────────────────────┘
                                 │ HTTP (polls every ~1.5s)
                                 ▼
            ┌─────────────────────────────────────────────┐
            │            API Server (Express + TS)         │
            │  - job & worker endpoints                    │
            │  - atomic claim (SKIP LOCKED)                │
            │  - retry + backoff logic                     │
            │  - REAPER loop (every 5s):                   │
            │      • mark stale workers dead               │
            │      • re-queue jobs with expired lease      │
            └───────────────┬───────────────┬─────────────┘
                            │               │
                  HTTP      │               │  SQL
          ┌─────────────────┘               ▼
          │                         ┌────────────────┐
          ▼                         │  PostgreSQL    │
  ┌──────────────┐  ┌──────────────┐│  jobs          │
  │  Worker  #1  │  │  Worker  #2  ││  workers       │
  │ register     │  │ register     ││  job_events    │
  │ claim → run  │  │ claim → run  │└────────────────┘
  │ progress     │  │ progress     │
  │ heartbeat 5s │  │ heartbeat 5s │
  └──────────────┘  └──────────────┘
```

**The single most important idea:** the queue lives *inside Postgres*, and assigning a job
is just an atomic `UPDATE` that picks the highest-priority unlocked `pending` row. Workers
compete to claim; the database guarantees exactly one wins each row. Everything else
(retry, recovery, history) hangs off that core.

---

## 5. Data model

Use Prisma. Three tables.

### `jobs`
| column            | type        | purpose                                                  |
|-------------------|-------------|----------------------------------------------------------|
| id                | uuid PK     |                                                          |
| type              | text        | which handler runs it (e.g. `simulate`)                  |
| payload           | jsonb       | input params for the handler                             |
| priority          | int         | higher = runs sooner (default 0)                         |
| status            | enum        | `pending` `running` `succeeded` `failed` `dead`          |
| progress          | int         | 0–100                                                    |
| attempts          | int         | incremented each time it's claimed                       |
| max_attempts      | int         | retry ceiling (default 3)                                |
| available_at      | timestamptz | job is only claimable when `available_at <= now()` (backoff) |
| lease_expires_at  | timestamptz | while running, worker must renew this or job is reclaimed |
| worker_id         | uuid FK?    | who is running it                                        |
| result            | jsonb?      | success output                                           |
| error             | text?       | last failure message                                     |
| created_at / updated_at / started_at / finished_at | timestamptz | timeline |

### `workers`
| column            | type        | purpose                                  |
|-------------------|-------------|------------------------------------------|
| id                | uuid PK     |                                          |
| name              | text        | hostname / label                         |
| status            | enum        | `active` `dead`                          |
| last_heartbeat_at | timestamptz | updated on every heartbeat               |
| registered_at     | timestamptz |                                          |

### `job_events` (append-only execution history)
| column     | type        | purpose                                                       |
|------------|-------------|---------------------------------------------------------------|
| id         | uuid PK     |                                                               |
| job_id     | uuid FK     |                                                               |
| worker_id  | uuid FK?    |                                                               |
| type       | text        | `created` `claimed` `progress` `succeeded` `failed` `retried` `requeued` `dead` |
| message    | text?       | human-readable detail                                         |
| created_at | timestamptz |                                                               |

> Every meaningful state change writes a `job_events` row. That's how the history view and
> the "tell the story of this job" demo moment both work.

---

## 6. Job lifecycle (the state machine)

```
              submit
                │
                ▼
            ┌────────┐   claimed (SKIP LOCKED)   ┌─────────┐
            │ pending│ ────────────────────────► │ running │
            └────────┘                           └────┬────┘
               ▲  ▲                                   │
               │  │ retry (attempts<max,              │ worker reports
   requeued    │  │  available_at = now+backoff)      │
   (lease      │  └───────────────┐         success   │   failure
    expired)   │                  │            │       │      │
               │             ┌────┴─────┐      ▼       ▼      ▼
               └─────────────│  failed  │ ┌──────────┐  attempts>=max
                             └──────────┘ │succeeded │       │
                                          └──────────┘       ▼
                                                          ┌──────┐
                                                          │ dead │
                                                          └──────┘
```

Rules:
- A job is **claimable** when `status = pending` AND `available_at <= now()`.
- On claim: `status=running`, `attempts++`, set `worker_id`, set `lease_expires_at = now()+30s`.
- On success: `status=succeeded`, store `result`, set `finished_at`.
- On failure: if `attempts < max_attempts` → `status=pending`, `available_at = now() + backoff`,
  log `retried`. Else → `status=dead`, log `dead`.
- **Backoff:** `delay = min(baseMs * 2^(attempts-1), maxMs)` (e.g. base 2s, max 60s).

---

## 7. The three queries that matter most

Put real comments above these in the code; reviewers love seeing you understand them.

**(a) Atomic claim — the heart of the scheduler.** Raw SQL via Prisma `$queryRaw`:
```sql
UPDATE jobs
SET status = 'running',
    worker_id = $1,
    attempts = attempts + 1,
    started_at = now(),
    lease_expires_at = now() + interval '30 seconds',
    updated_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending' AND available_at <= now()
  ORDER BY priority DESC, created_at ASC   -- prioritization
  FOR UPDATE SKIP LOCKED                    -- atomic assignment
  LIMIT 1
)
RETURNING *;
```
If this returns no row, there's no work right now and the worker waits.

**(b) Reaper: re-queue jobs from crashed workers.** Runs server-side every ~5s:
```sql
UPDATE jobs
SET status = 'pending', worker_id = NULL, available_at = now(), lease_expires_at = NULL
WHERE status = 'running' AND lease_expires_at < now()
RETURNING id;
-- (then write a 'requeued' job_event for each id)
```

**(c) Reaper: mark dead workers.** A worker is dead if we haven't heard from it:
```sql
UPDATE workers
SET status = 'dead'
WHERE status = 'active' AND last_heartbeat_at < now() - interval '15 seconds';
```

---

## 8. API surface

**User-facing (used by the dashboard):**
- `POST /api/jobs` — body `{ type, payload, priority?, max_attempts? }` → creates job
- `GET  /api/jobs?status=` — list jobs (newest first)
- `GET  /api/jobs/:id` — job detail + its `job_events`
- `GET  /api/workers` — list workers with health/last heartbeat

**Worker-facing:**
- `POST /api/workers/register` — body `{ name }` → returns `{ id }`
- `POST /api/workers/:id/heartbeat` — refresh health; also renews lease of its running job
- `POST /api/workers/:id/claim` — runs query (a); returns a job or `204 No Content`
- `POST /api/jobs/:id/progress` — body `{ progress }` (worker also renews lease here)
- `POST /api/jobs/:id/complete` — body `{ status: 'succeeded'|'failed', result?, error? }`

Keep handlers thin: validate input, call a service function, return JSON. All queue logic
lives in service modules (`jobService`, `workerService`, `reaper`), not in routes.

---

## 9. The worker runtime

A worker is a small loop:
1. On start: `register` → store own `workerId`.
2. Start a heartbeat timer: every 5s `POST /workers/:id/heartbeat`.
3. Main loop: `POST /workers/:id/claim`.
   - Got a job → look up its handler by `type`, run it, calling `progress` as it advances,
     then `complete` with success or failure. Wrap in try/catch so a thrown handler = failure.
   - Got `204` → sleep ~1s, loop again.
4. On `SIGINT`/`SIGTERM`: stop claiming, optionally finish current job, exit. (For the demo
   you'll *kill it mid-job* to prove recovery — that's intentional.)

**Job handlers** live in a small registry `{ [type]: (payload, ctx) => Promise<result> }`.
Ship at least one flexible handler:

- `simulate` with payload `{ steps, stepMs, failRate }`: loops `steps` times, sleeps
  `stepMs`, reports progress each step, and throws with probability `failRate`. This one
  handler lets you demo progress bars, retries (set failRate high), long-running jobs, and
  crash recovery — all from the UI. Add `fibonacci` / `sum_primes` too if you want
  "real computation" on camera.

---

## 10. Frontend (dashboard)

Four views, all polling the API with TanStack Query (`refetchInterval: 1500`):
1. **Submit** — a form: type, priority, max_attempts, and a small JSON/payload area.
2. **Queue / Jobs** — table of jobs: id, type, priority, status badge, progress bar,
   attempts, worker. Color the status. This is the screen you'll keep open during the demo.
3. **Workers** — cards showing each worker, status (active/dead), seconds since last
   heartbeat. A worker going red live on camera is a great moment.
4. **Job detail** — the `job_events` timeline so you can "narrate the life of one job."

Keep styling clean and minimal (Tailwind). Polish is not graded; clarity is.

---

## 11. Repo / folder structure

```
job-platform/
├── CLAUDE.md
├── Architecture.md          # required deliverable (write last, from this file)
├── Agent.md                 # required: how AI was used (prompts, workflow)
├── Readme.md                # required: install, env, run, test, assumptions
├── docker-compose.yml       # postgres (and optionally everything)
├── .env.example
├── package.json             # npm workspaces: server, worker, web, shared
├── shared/                  # shared TS types (Job, Worker, enums)
├── server/
│   ├── prisma/schema.prisma
│   └── src/
│       ├── index.ts         # express bootstrap + start reaper
│       ├── routes/          # jobs.ts, workers.ts
│       ├── services/        # jobService.ts, workerService.ts, reaper.ts
│       └── db.ts            # prisma client
├── worker/
│   └── src/
│       ├── index.ts         # the loop
│       └── handlers/        # simulate.ts, fibonacci.ts
└── web/                     # next.js app
    └── app/                 # submit / jobs / workers / jobs/[id]
```

---

## 12. Build order (do it in this sequence — each step is demo-able)

**P0 — must work**
1. `docker-compose up` Postgres; Prisma schema + migrate; seed nothing.
2. Server boots; `POST /jobs` + `GET /jobs` work.
3. Worker registers + heartbeats; `GET /workers` shows it.
4. Atomic claim query works; worker claims, runs `simulate`, reports progress, completes.
5. Minimal dashboard: submit + jobs table with live progress.

**P1 — the features that win points**
6. Retry with backoff on failure (test with `failRate: 1`).
7. Reaper: dead-worker detection + job re-queue (test by killing a worker mid-job).
8. Priority ordering (submit low+high together, watch high go first).
9. `job_events` history + job-detail timeline view.
10. Workers view with live heartbeat staleness.

**P2 — only if time remains**
11. Cancel a job. 12. Graceful worker shutdown. 13. SSE instead of polling.
14. Basic charts (jobs by status). 15. Concurrency per worker.

Write `Architecture.md`, `Agent.md`, `Readme.md` **after** the code works, pulling
straight from this file. Don't gold-plate; ship the core and document it well.

---

## 13. Coding conventions (the reviewers said "human-readable")

- TypeScript everywhere; no `any` in domain types. Define `JobStatus`, `WorkerStatus` enums.
- Small, single-purpose functions with descriptive names (`claimNextJob`, not `doJob`).
- Comment the **why**, not the what. The three core queries each get a comment explaining
  `SKIP LOCKED`, the lease, and the backoff.
- Keep routes thin; put logic in `services/`. One concept per file.
- Centralize the constants that matter (`HEARTBEAT_MS=5000`, `LEASE_MS=30000`,
  `REAPER_MS=5000`, `WORKER_DEAD_MS=15000`, backoff base/max) in one `config.ts` so you
  can point at them on camera and explain the timing relationships.
- A short `Readme.md` quickstart that actually works from a clean clone. Test it.

---

## 14. Design decisions & trade-offs (REHEARSE THESE — this is the interview)

Be ready to say each of these out loud in your own words:

1. **Postgres as the queue (vs Redis/RabbitMQ/Kafka).** Chose Postgres because
   `SKIP LOCKED` gives atomic assignment and ACID retries with zero extra infrastructure.
   Trade-off: it won't scale to millions of jobs/sec like Kafka, but it's the right call for
   correctness and clarity at this scale, and Postgres queues are a well-known production
   pattern. *If asked "what would you change at 100x scale?"* → move hot path to Redis
   streams or a dedicated broker, shard jobs, add a read replica for the dashboard.
2. **Pull model (workers claim) vs push (scheduler assigns).** Pull self-balances — a free
   worker takes the next job; no central scheduler to become a bottleneck or single point of
   failure. Trade-off: tiny polling latency, which is fine here.
3. **Lease + heartbeat for crash recovery.** A running job has a lease the worker must renew.
   If the worker dies, the lease expires and the reaper re-queues the job. This is the same
   "visibility timeout" idea AWS SQS uses. Trade-off: a job could run twice if a worker
   stalls but isn't truly dead → so handlers should be **idempotent** (say this; it shows
   maturity).
4. **Polling UI (vs WebSockets/SSE).** Polling every 1.5s is dead simple, stateless, and
   plenty for a dashboard. Trade-off: not truly real-time and more requests; I'd switch to
   SSE if updates needed to be instant.
5. **Exponential backoff on retries.** Prevents a broken job from hammering the system in a
   tight failure loop; spaces out retries so transient issues can clear.
6. **At-least-once, not exactly-once.** Honest framing: distributed systems can't get
   exactly-once for free, so we guarantee at-least-once and lean on idempotent handlers.
   Saying this sentence will make you sound like you've actually thought about it.

---

## 15. Known limitations to state proactively (don't hide them)

Naming your own gaps reads as senior, not weak:
- No auth (out of scope for the assessment).
- Single API server is a SPOF; in production run several behind a load balancer (the queue
  in Postgres already supports that — they'd share the same claim query).
- Polling, not push. At-least-once delivery. No per-worker concurrency limit unless P2 done.
- These are deliberate scope cuts to ship a correct core in the time available.