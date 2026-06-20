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
