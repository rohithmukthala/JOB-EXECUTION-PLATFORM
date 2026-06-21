# How AI was used

This project was built with heavy use of AI, which the assessment explicitly allows. I want to
be straightforward about that and equally clear about what I owned: the architecture, the
decisions, the reviewing, and the understanding. AI was the implementation accelerator; the
engineering judgment is mine, and I can walk through any part of the system and explain why it
works the way it does.

Two AI surfaces were used:
- **Claude (chat)** for the thinking — comparing options, pressure-testing the design, and
  working through the trade-offs before any code existed.
- **Claude Code** for implementation — turning the agreed design into the actual server,
  worker, and dashboard, iterating against tests and a running stack.

## How I worked

1. **Design first, in my own head and in chat.** Before generating code, I settled the
   decisions that define this system: use Postgres as the queue (atomic claim via
   `SKIP LOCKED`), have workers *pull* jobs instead of a scheduler pushing them, recover from
   crashes with a lease + heartbeat, and keep the dashboard simple with polling. I used Claude
   to challenge these choices and surface trade-offs, but the calls are mine and they're
   documented in `Architecture.md`.

2. **Implement in small, verifiable pieces.** Rather than asking for the whole app at once, I
   had it built feature by feature in the order in `CLAUDE.md` (submission -> registration ->
   atomic scheduling -> progress -> retry -> crash recovery -> priority -> history), so I could
   run and check each piece before moving on.

3. **Review everything before accepting it.** This is the part that matters most. Whenever AI
   produced something I couldn't explain — especially the atomic claim query, the retry/backoff
   logic, and the reaper — I read it line by line and either understood it or had it explained
   back to me until I did. Nothing shipped that I can't defend.

4. **Verify against the real system.** Beyond passing tests, I exercised the hard parts live:
   priority ordering, a job failing and retrying with growing backoff until it goes `dead`, and
   the key one — killing a worker mid-job and watching its job get re-queued and finished by
   another worker, with no double-claims across multiple workers.

## Example prompts / workflow

A representative slice of how I drove it (replace/extend with your actual prompts):

- *"Compare using Postgres with SKIP LOCKED vs Redis vs RabbitMQ for the job queue in this
  system. What are the trade-offs at this scale?"* — to settle the core decision.
- *"[FILL IN one real implementation prompt you used, e.g.: Implement the atomic job-claim
  query as raw SQL with SKIP LOCKED, ordered by priority then age, incrementing attempts and
  setting a 30s lease.]"*
- *"[FILL IN one real debugging/review prompt, e.g.: Explain what this reaper query does and
  what happens if a worker's heartbeat is delayed but it isn't actually dead.]"*

## What stayed mine

- **The architecture and its trade-offs** — Postgres-as-queue, pull workers, lease+heartbeat
  recovery, polling UI — all chosen deliberately and explained in `Architecture.md`.
- **Scope discipline** — I kept the build to the core (P0+P1) and consciously left out auth,
  websockets, and other extras for time, rather than letting the tool sprawl.
- **Understanding** — the real deliverable. I can explain the lifecycle, the three core queries,
  and the recovery flow without notes, because I made sure of that as I went.

## Why I worked this way

Using AI for the mechanical work while keeping the design, review, and verification in my own
hands let me build a correct, well-understood system quickly. The thing I optimized for wasn't
"who typed the code" — it was a small, typed, test-backed codebase where every required feature
maps to a change I can stand behind and explain.

Tooling: Claude (chat) for design and reasoning; Claude Code for implementation and iteration.