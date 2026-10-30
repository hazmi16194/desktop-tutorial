import path from 'node:path';
import { Store } from './store.js';
import { WhatsApp } from './whatsapp.js';
import { AI } from './ai.js';
import { createCommandHandler } from './commands.js';

export function createContext(cfg, { persist = true, log = (m) => console.log(new Date().toISOString(), m) } = {}) {
  const ctx = { cfg, log };
  ctx.store = new Store(persist ? path.join(cfg.dataDir, 'db.json') : null);
  ctx.wa = new WhatsApp(cfg, log);
  ctx.ai = new AI(cfg);
  ctx.handle = createCommandHandler(ctx);
  return ctx;
}
