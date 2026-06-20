# Distributed Job Execution Platform — Design

> Approved 2026-06-20. This is the build-level spec; the conceptual source of truth and
> the decision/trade-off rationale live in `CLAUDE.md`. Read both before implementing.

## Scope

**Build P0 + P1 (the full core assignment).** P2 is out of scope for this pass.

P0: Postgres up, Prisma schema/migrate, server boots, `POST/GET /jobs`, worker
register+heartbeat, atomic claim, worker runs `simulate` with progress, minimal jobs table.

P1: retry+backoff, reaper (dead-worker detection + lease re-queue), priority ordering,
`job_events` history + job-detail timeline, workers view with heartbeat staleness.

## Runtime decision

**Postgres runs in Docker (`docker-compose up`); server, worker(s), and web run as local
npm processes**, each in its own terminal. Rationale: killing one worker mid-job in its own
terminal is the cleanest way to demonstrate crash recovery, and it matches the "N workers in
N terminals" model. This is the one decision made beyond CLAUDE.md.

## Stack (concrete)

- Node 24 + TypeScript, Express 4
- Prisma 5 + PostgreSQL 16 (Docker)
- Next.js 14 (App Router) + React 18 + Tailwind + TanStack Query (poll 1500ms)
- npm workspaces: `shared`, `server`, `worker`, `web`

## Repo layout (per CLAUDE.md §11)

```
shared/            shared TS types + enums (JobStatus, WorkerStatus, event types)
server/
  prisma/schema.prisma
  src/index.ts     express bootstrap + start reaper
  src/routes/      jobs.ts, workers.ts        (thin: validate → service → JSON)
  src/services/    jobService.ts, workerService.ts, reaper.ts
  src/db.ts        prisma client
  src/config.ts    HEARTBEAT_MS, LEASE_MS, REAPER_MS, WORKER_DEAD_MS, backoff base/max
worker/
  src/index.ts     register → heartbeat timer → claim/run/progress/complete loop
  src/handlers/    simulate.ts, fibonacci.ts
web/app/           submit / jobs / workers / jobs/[id]
docker-compose.yml postgres only
.env.example
```

## Data model (per CLAUDE.md §5)

Three tables: `jobs`, `workers`, `job_events`. Status enums:
`JobStatus = pending | running | succeeded | failed | dead`; `WorkerStatus = active | dead`.
Every meaningful state change appends a `job_events` row.

## Core mechanics (per CLAUDE.md §6–§7)

- **Atomic claim**: raw SQL via Prisma `$queryRaw`, `FOR UPDATE SKIP LOCKED`,
  `ORDER BY priority DESC, created_at ASC`. Sets running, attempts++, worker_id,
  `lease_expires_at = now()+30s`. No row → worker waits.
- **Reaper every 5s**: (b) re-queue `running` jobs with `lease_expires_at < now()`, write
  `requeued` event; (c) mark `active` workers `dead` when
  `last_heartbeat_at < now() - 15s`.
- **Retry/backoff**: on failure, if `attempts < max_attempts` → `pending`,
  `available_at = now() + min(2000·2^(attempts-1), 60000)ms`, log `retried`; else `dead`.
- **Timing constants** centralized in `config.ts`: HEARTBEAT_MS=5000, LEASE_MS=30000,
  REAPER_MS=5000, WORKER_DEAD_MS=15000, backoff base=2000, max=60000.

## API (per CLAUDE.md §8) — 9 endpoints

User: `POST /api/jobs`, `GET /api/jobs?status=`, `GET /api/jobs/:id`, `GET /api/workers`.
Worker: `POST /api/workers/register`, `POST /api/workers/:id/heartbeat`,
`POST /api/workers/:id/claim`, `POST /api/jobs/:id/progress`, `POST /api/jobs/:id/complete`.

## Worker runtime (per CLAUDE.md §9)

Loop: register → 5s heartbeat timer → claim. Got job → run handler by `type`, report
progress, complete (try/catch → failure). Got 204 → sleep ~1s. SIGINT → stop claiming, exit.
Handlers: `simulate {steps, stepMs, failRate}`, `fibonacci`.

## Frontend (per CLAUDE.md §10)

Four TanStack Query views polling 1500ms: Submit form, Jobs table (status badge + live
progress bar), Workers cards (active/dead + seconds since heartbeat), Job detail timeline.

## Boundaries

Routes thin; logic in services. Workers talk only HTTP, never DB. Server is single source of
truth. No `any` in domain types. Comment the *why* on the three core queries.

## Verification plan (per CLAUDE.md §12)

Each item demo-checked: atomic claim concurrency-tested with two workers (no double-claim);
retry tested with `failRate:1`; recovery tested by killing a worker mid-job and watching the
reaper re-queue; priority tested by submitting low+high together.

## Out of scope

No auth. Single API server (SPOF, acceptable). Polling not push. At-least-once delivery
(handlers should be idempotent). No per-worker concurrency. P2 bonus items.
