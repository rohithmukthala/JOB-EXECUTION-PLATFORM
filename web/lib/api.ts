import type { Job, JobEvent, Worker } from "./types";

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
