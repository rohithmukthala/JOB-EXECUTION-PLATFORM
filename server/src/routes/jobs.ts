import { Router } from "express";
import { z } from "zod";
import { createJob, getJob, listJobs, setProgress, completeJob } from "../services/jobService.js";
import { asyncHandler } from "./asyncHandler.js";

export const jobsRouter = Router();

const createSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown().optional(),
  priority: z.number().int().optional(),
  maxAttempts: z.number().int().positive().optional(),
});

jobsRouter.post("/", asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const job = await createJob(parsed.data);
  res.status(201).json(job);
}));

jobsRouter.get("/", asyncHandler(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await listJobs(status));
}));

jobsRouter.get("/:id", asyncHandler(async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
}));

jobsRouter.post("/:id/progress", asyncHandler(async (req, res) => {
  const parsed = z.object({ progress: z.number() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const job = await setProgress(req.params.id, parsed.data.progress);
  res.json(job);
}));

jobsRouter.post("/:id/complete", asyncHandler(async (req, res) => {
  const parsed = z.object({
    status: z.enum(["succeeded", "failed"]),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const job = await completeJob(req.params.id, parsed.data);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
}));
