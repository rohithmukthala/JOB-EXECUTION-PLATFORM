export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "dead";
export type WorkerStatus = "active" | "dead";

export type JobEventType =
  | "created" | "claimed" | "progress" | "succeeded"
  | "failed" | "retried" | "requeued" | "dead";

export interface Job {
  id: string;
  type: string;
  payload: unknown;
  priority: number;
  status: JobStatus;
  progress: number;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt: string | null;
  workerId: string | null;
  result: unknown | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Worker {
  id: string;
  name: string;
  status: WorkerStatus;
  lastHeartbeatAt: string;
  registeredAt: string;
}

export interface JobEvent {
  id: string;
  jobId: string;
  workerId: string | null;
  type: JobEventType;
  message: string | null;
  createdAt: string;
}

export interface CreateJobInput {
  type: string;
  payload?: unknown;
  priority?: number;
  maxAttempts?: number;
}

export interface CompleteJobInput {
  status: "succeeded" | "failed";
  result?: unknown;
  error?: string;
}
