import express from "express";
import { jobsRouter } from "./routes/jobs.js";
import { workersRouter } from "./routes/workers.js";

// App factory so tests can spin up the API without starting the reaper/listener.
export function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/jobs", jobsRouter);
  app.use("/api/workers", workersRouter);
  return app;
}
