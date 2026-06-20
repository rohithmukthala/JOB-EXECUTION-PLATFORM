import { register, heartbeat, claim, reportProgress, complete } from "./api.js";
import { handlers } from "./handlers/index.js";
import { HEARTBEAT_MS, IDLE_SLEEP_MS, WORKER_NAME } from "./config.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = true;

async function main() {
  const id = await register(WORKER_NAME);
  console.log(`[worker] registered ${WORKER_NAME} as ${id}`);

  const hb = setInterval(() => heartbeat(id).catch(() => {}), HEARTBEAT_MS);

  const shutdown = () => { running = false; clearInterval(hb); console.log("[worker] stopping"); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    const job = await claim(id).catch(() => null);
    if (!job) { await sleep(IDLE_SLEEP_MS); continue; }

    console.log(`[worker] claimed job ${job.id} (${job.type})`);
    const handler = handlers[job.type];
    if (!handler) { await complete(job.id, "failed", undefined, `no handler for type "${job.type}"`); continue; }

    try {
      const result = await handler(job.payload, { progress: (p) => reportProgress(job.id, p) });
      await complete(job.id, "succeeded", result);
      console.log(`[worker] job ${job.id} succeeded`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await complete(job.id, "failed", undefined, msg);
      console.log(`[worker] job ${job.id} failed: ${msg}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
