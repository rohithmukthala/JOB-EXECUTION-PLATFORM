export const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const HEARTBEAT_MS = 5_000;
export const IDLE_SLEEP_MS = 1_000;
export const WORKER_NAME = process.env.WORKER_NAME ?? `worker-${process.pid}`;
