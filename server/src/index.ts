import { createApp } from "./app.js";
import { startReaper } from "./services/reaper.js";
import { PORT } from "./config.js";

const app = createApp();
startReaper();
app.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));
