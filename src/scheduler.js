import { collect, report } from './analytics.js';
import { runDue } from './planner.js';
import { pollReplies } from './replies.js';
import { localParts } from './util.js';

export async function pollAndNotify(ctx) {
  for (const n of await pollReplies(ctx)) await ctx.wa.notify(n.owner, n.text);
}

export async function dailyDigest(ctx, now = Date.now()) {
  const { date, hour } = localParts(now, ctx.cfg.tz);
  if (hour !== ctx.cfg.digestHour || ctx.store.data.meta.lastDigest === date) return false;
  ctx.store.update((d) => { d.meta.lastDigest = date; });
  await collect(ctx);
  for (const owner of ctx.cfg.owners) {
    if (!Object.values(ctx.store.data.accounts).some((a) => a.owner === owner)) continue;
    const queued = ctx.store.data.posts.filter((p) => p.owner === owner && p.status === 'scheduled').length;
    await ctx.wa.notify(owner, `☀️ Good morning! Daily digest\n\n${report(ctx, owner)}\n\nQueued posts: ${queued}. Send *plan* for the calendar.`);
  }
  return true;
}

export function startScheduler(ctx) {
  const guarded = (name, fn) => async () => {
    try { await fn(); } catch (e) { ctx.log(`${name} failed: ${e.message}`); }
  };
  const timers = [
    setInterval(guarded('publish', () => runDue(ctx)), 60 * 1000),
    setInterval(guarded('digest', () => dailyDigest(ctx)), 60 * 1000),
    setInterval(guarded('replies', () => pollAndNotify(ctx)), 10 * 60 * 1000),
    setInterval(guarded('collect', () => collect(ctx)), 60 * 60 * 1000),
  ];
  guarded('collect', () => collect(ctx))();
  return () => timers.forEach(clearInterval);
}
