import { Router } from "express";
import { z } from "zod";
import { claimJob, heartbeat, listWorkers, registerWorker } from "../services/workerService.js";

export const workersRouter = Router();

workersRouter.get("/", async (_req, res) => res.json(await listWorkers()));

workersRouter.post("/register", async (req, res) => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const worker = await registerWorker(parsed.data.name);
  res.status(201).json(worker);
});

workersRouter.post("/:id/heartbeat", async (req, res) => {
  const worker = await heartbeat(req.params.id);
  res.json(worker);
});

workersRouter.post("/:id/claim", async (req, res) => {
  const job = await claimJob(req.params.id);
  if (!job) return res.status(204).end();
  res.json(job);
});
