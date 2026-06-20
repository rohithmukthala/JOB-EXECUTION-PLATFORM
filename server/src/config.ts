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
