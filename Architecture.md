# Architecture

## The core idea

The job queue **is the Postgres database**. There is no separate broker (RabbitMQ, Redis,
Kafka). Assigning a job to a worker is a single atomic SQL statement that selects the
highest-priority claimable row, locks it so no other worker can take it, and flips it to
`running` — all in one transaction. Everything else (retries, crash recovery, history)
hangs off that core.

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

Workers never touch the database. They speak only HTTP to the API server, which owns all
queue logic and is the single source of truth. This keeps workers dumb and the system
genuinely distributed — start five workers in five terminals with no extra config.

## Components

- **`server/`** — Express + TypeScript. Thin routes (`routes/jobs.ts`, `routes/workers.ts`)
  validate input with Zod and delegate to services. All logic lives in
  `services/jobService.ts` (create/list/get, progress, complete + retry/backoff, event log),
  `services/workerService.ts` (register, heartbeat, **atomic claim**), and
  `services/reaper.ts` (crash recovery). Prisma owns the schema, migrations, and ordinary
  reads/writes; the one place the ORM can't express what we need — the claim — drops to raw
  SQL via `$queryRaw`.
- **`worker/`** — a small loop: register → heartbeat every 5s → claim → run the handler by
  `type` (reporting progress) → complete (success or failure). A thrown handler = a failure.
- **`web/`** — Next.js App Router dashboard, polling the API with TanStack Query at 1.5s.
- **`shared/`** — the domain types (`Job`, `Worker`, `JobEvent`, status enums) shared across
  server, worker, and web so the state machine is typed end-to-end.

## Data model (three tables)

- **`jobs`** — the work and its full state: `type`, `payload`, `priority`, `status`
  (`pending | running | succeeded | failed | dead`), `progress`, `attempts`/`maxAttempts`,
  `availableAt` (backoff gate), `leaseExpiresAt` (crash-recovery lease), `workerId`,
  `result`/`error`, and timeline timestamps.
- **`workers`** — `name`, `status` (`active | dead`), `lastHeartbeatAt`.
- **`job_events`** — append-only audit log. Every meaningful state change writes a row
  (`created`, `claimed`, `progress`, `succeeded`, `failed`, `retried`, `requeued`, `dead`),
  which powers both the history view and "tell the story of this job."

## The three queries that matter

### (a) Atomic claim — the heart of the scheduler

```sql
UPDATE jobs
SET status = 'running', worker_id = $1, attempts = attempts + 1,
    started_at = now(), lease_expires_at = now() + interval '30 seconds', updated_at = now()
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'pending' AND available_at <= now()
  ORDER BY priority DESC, created_at ASC   -- prioritization
  FOR UPDATE SKIP LOCKED                    -- atomic assignment
  LIMIT 1
)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` is the linchpin: each concurrent worker locks and takes a
*different* row, so the same job can never be handed to two workers. `attempts++` and the
lease are set in the **same** statement as the status flip — ACID guarantees they happen
together. `available_at <= now()` is how backoff defers retries; `ORDER BY priority DESC`
is the prioritization. No row returned → no work right now → the worker sleeps and retries.

### (b) Reaper — re-queue jobs from crashed workers

```sql
UPDATE jobs
SET status = 'pending', worker_id = NULL, available_at = now(), lease_expires_at = NULL
WHERE status = 'running' AND lease_expires_at < now()
RETURNING id;          -- then write a 'requeued' job_event for each
```

A running job carries a **lease** that its worker must renew (via heartbeat or progress). A
live worker renews well within the 30s lease; a dead worker can't, so its job's lease expires
and the reaper makes it `pending` again for someone else. This is exactly AWS SQS's
"visibility timeout" idea.

### (c) Reaper — mark dead workers

```sql
UPDATE workers SET status = 'dead'
WHERE status = 'active' AND last_heartbeat_at < now() - interval '15 seconds';
```

## Job lifecycle

```
submit → pending → (claim) → running → succeeded
                ▲              │  └→ failed → (attempts<max) retry → pending (after backoff)
                │              │            → (attempts>=max) → dead
                └──────────────┘  (lease expires → requeued)
```

- **Claimable** when `status = pending` and `available_at <= now()`.
- **On failure:** if `attempts < maxAttempts` → back to `pending` with
  `available_at = now() + backoff`, log `retried`; else → `dead`.
- **Backoff:** `delay = min(base · 2^(attempts-1), max)` — base 2s, max 60s.

## Timing constants (centralized in `server/src/config.ts`)

| constant          | value  | relationship |
|-------------------|--------|--------------|
| `HEARTBEAT_MS`    | 5000   | worker beats every 5s |
| `WORKER_DEAD_MS`  | 15000  | a worker must miss ~3 beats to be declared dead |
| `LEASE_MS`        | 30000  | a job's lease; a live worker renews it long before expiry |
| `REAPER_MS`       | 5000   | reaper sweeps every 5s, well inside the lease window |

The key invariant: `HEARTBEAT < WORKER_DEAD` and `REAPER < LEASE`, so healthy workers are
never falsely reaped, but a truly dead worker's job is recovered within ~one lease.

## Design decisions & trade-offs

1. **Postgres as the queue** (vs Redis/RabbitMQ/Kafka). `SKIP LOCKED` gives atomic
   assignment and ACID retries with zero extra infrastructure — one dependency we fully
   understand. It won't do millions of jobs/sec like Kafka; at 100x scale we'd move the hot
   path to a dedicated broker, shard jobs, and add a read replica for the dashboard.
2. **Pull model** (workers claim) vs push (a scheduler assigns). Pull self-balances and has
   no central scheduler to become a bottleneck or SPOF; the cost is a little polling latency.
3. **Lease + heartbeat for crash recovery** — the SQS visibility-timeout pattern. A job could
   run twice if a worker stalls without truly dying, so handlers should be **idempotent**.
4. **Polling UI** (vs WebSockets/SSE) — dead simple and stateless; plenty for a dashboard.
5. **Exponential backoff** prevents a broken job from hammering the system in a tight loop.
6. **At-least-once, not exactly-once** — honest framing: distributed systems don't get
   exactly-once for free, so we guarantee at-least-once and rely on idempotent handlers.

## Verified behavior

The P1 features were verified live (see `Agent.md` for how): priority ordering (priority-10
job started before priority-0), retry with 2s/4s backoff ending in `dead` at the attempt
ceiling, crash recovery (worker killed mid-job → marked `dead`, job `requeued` on lease
expiry, finished by a second worker), and no double-claims across 3 concurrent workers. The
`SKIP LOCKED` guarantee also has a dedicated concurrency unit test.
```
