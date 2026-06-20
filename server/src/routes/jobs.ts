import { Router } from "express";
import { z } from "zod";
import { createJob, getJob, listJobs } from "../services/jobService.js";

export const jobsRouter = Router();

const createSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown().optional(),
  priority: z.number().int().optional(),
  maxAttempts: z.number().int().positive().optional(),
});

jobsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const job = await createJob(parsed.data);
  res.status(201).json(job);
});

jobsRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await listJobs(status));
});

jobsRouter.get("/:id", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not found" });
  res.json(job);
});
