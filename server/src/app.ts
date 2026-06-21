import express from "express";
import { jobsRouter } from "./routes/jobs.js";
import { workersRouter } from "./routes/workers.js";

// App factory so tests can spin up the API without starting the reaper/listener.
export function createApp() {
  const app = express();

  // The dashboard runs on a different origin (localhost:3000) and calls this API
  // directly from the browser, so we must send CORS headers or the browser blocks
  // every request. No auth here, so allowing any origin is fine for this scope.
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/jobs", jobsRouter);
  app.use("/api/workers", workersRouter);
  return app;
}
