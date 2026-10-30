import { loadConfigFromEnvFile } from './config.js';
import { createContext } from './context.js';
import { createServer } from './server.js';
import { startScheduler } from './scheduler.js';

const cfg = loadConfigFromEnvFile();
const ctx = createContext(cfg);

if (!Object.keys(cfg.waAllowed).length) {
  console.error('WA_ALLOWED is empty – nobody could control the bot. See .env.example');
  process.exit(1);
}
if (!cfg.dryRun && !cfg.wa.appSecret) {
  console.error('WA_APP_SECRET is required to verify WhatsApp webhooks (or run with DRY_RUN=1).');
  process.exit(1);
}

const server = createServer(ctx);
server.listen(cfg.port, () => ctx.log(`Social HQ listening on :${cfg.port} (tz ${cfg.tz}${cfg.dryRun ? ', DRY RUN' : ''})`));
const stop = startScheduler(ctx);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stop(); server.close(() => process.exit(0)); });
}
