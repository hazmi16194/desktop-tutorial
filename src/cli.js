// Local "fake WhatsApp" so you can try every command without any API keys:  npm run demo
import readline from 'node:readline';
import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { startConnect } from './oauth.js';
import { PLATFORMS } from './platforms/index.js';
import { mockInjectReply } from './platforms/mock.js';
import { pollAndNotify } from './scheduler.js';
import { runDue } from './planner.js';

const cfg = loadConfig({
  ...process.env, DRY_RUN: '1', OWNERS: 'hazmi,wife', WA_ALLOWED: '60100000001:hazmi,60100000002:wife', TIMEZONE: process.env.TIMEZONE || 'Asia/Kuala_Lumpur',
});
const ctx = createContext(cfg, { persist: false, log: () => {} });
ctx.wa.log = (m) => console.log(m);

for (const o of cfg.owners) for (const p of PLATFORMS) startConnect(ctx, o, p);
await pollAndNotify(ctx); // baseline

console.log(`Social HQ demo – you are "hazmi" (use "as wife: <cmd>" to speak as wife).
Extra demo-only commands:  :reply <text>   simulate a fan replying on hazmi's Threads, then polls
                           :tick          run the scheduler once (publishes due posts)
Type "help" to start, Ctrl+C to quit.\n`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
rl.prompt();
for await (const line of rl) {
  const text = line.trim();
  try {
    if (text.startsWith(':reply ')) {
      mockInjectReply('hazmi:threads', text.slice(7), 'demo_fan');
      await pollAndNotify(ctx);
    } else if (text === ':tick') {
      console.log(`published ${await runDue(ctx)} due post(s)`);
    } else if (text) {
      const asWife = text.startsWith('as wife:');
      const out = await ctx.handle(asWife ? '60100000002' : '60100000001', asWife ? text.slice(8).trim() : text);
      if (out) console.log(out + '\n');
    }
  } catch (e) {
    console.log('error:', e.message);
  }
  rl.prompt();
}
