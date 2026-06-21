# How AI was used

This project was built with Claude Code using a disciplined, multi-stage workflow rather
than ad-hoc prompting. The goal was a correct, well-understood core — not just generated
code — so every stage left an artifact a human can read and defend.

## Workflow

1. **Brainstorm → spec.** Starting from the project brief in `CLAUDE.md`, we settled the open
   decisions (scope = P0+P1 full core; runtime = Postgres in Docker with server/worker/web as
   local processes for clean crash-recovery demos) and wrote a build-level spec:
   `docs/superpowers/specs/2026-06-20-job-platform-design.md`.

2. **Spec → implementation plan.** The spec became a step-by-step, test-first plan:
   `docs/superpowers/plans/2026-06-20-job-platform.md` — 15 bite-sized tasks, each with exact
   file paths, complete code, the test to write first, the command to run, and a commit. The
   plan was self-reviewed against the spec for coverage and type consistency before any code.

3. **Plan → subagent-driven execution.** Tasks were implemented one at a time by fresh
   subagents with curated context (no shared history), following TDD. The logic-heavy tasks
   (jobService, the atomic claim, retry/backoff, the reaper) each went through a spec-
   compliance review and a code-quality review by separate reviewer subagents before being
   accepted. Foundation/config tasks were verified directly. Every task ended in a git commit.

4. **Live verification.** Beyond unit tests, the P1 features were exercised against the real
   running stack: priority ordering, retry→dead with exponential backoff, **crash recovery**
   (a worker killed mid-job, observed going `dead`, its job `requeued` on lease expiry and
   finished by another worker), and no double-claims across three concurrent workers.

## What the human kept control of

- **Scope.** When a reviewer suggested an optional hardening (ownership-scoping
  `completeJob`) beyond the approved plan, it was deliberately *not* added — `CLAUDE.md` takes
  the explicit at-least-once + idempotent-handlers stance, and reviewer "nice-to-haves" aren't
  authorization to expand scope. A verification subagent that overstepped and made unrequested
  code changes was reverted back to the reviewed, green state.
- **Decisions.** The architectural choices (Postgres-as-queue, pull model, lease+heartbeat,
  polling UI) come from the spec and are documented with their trade-offs in
  `Architecture.md`, so they can be explained rather than just shipped.

## Why this approach

Fresh-context subagents keep each task focused and prevent context pollution; the two-stage
review (does it match the spec? is it well-built?) catches both over/under-building and
quality issues early, when they're cheap. The result is a small, typed, test-backed codebase
where every required feature maps to a specific, reviewed change — and the tests run against a
real Postgres because the queue's correctness (`SKIP LOCKED`, leases) can't be mocked.

Tooling: Claude Code (Opus) as the orchestrator; general-purpose subagents for implementation
and review. Artifacts (spec, plan, this file) are committed alongside the code.
```
