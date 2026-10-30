import { DAY, clip, fmtNum, localParts } from './util.js';
import { connectedKeys, getClient } from './platforms/index.js';

const eng = (p) => (p.likes || 0) + (p.replies || 0) + (p.reposts || 0) + (p.quotes || 0) + (p.shares || 0);
const rate = (e, v) => (v > 0 ? (e / v) * 100 : 0);

/** Pull fresh follower counts + recent posts (with metrics) from every connected account. */
export async function collect(ctx) {
  for (const key of connectedKeys(ctx)) {
    try {
      const c = getClient(ctx, key);
      const [stats, posts] = await Promise.all([c.stats(), c.listPosts(25)]);
      ctx.store.update((d) => {
        d.snapshots.push({ t: Date.now(), key, ...stats });
        d.snapshots = d.snapshots.filter((s) => s.t > Date.now() - 120 * DAY);
        d.remote[key] = posts;
      });
    } catch (e) {
      ctx.log(`collect ${key} failed: ${e.message}`);
    }
  }
}

function bestHours(posts, tz) {
  if (posts.length < 3) return null;
  const buckets = new Map();
  for (const p of posts) {
    const h = localParts(p.time, tz).hour;
    const b = buckets.get(h) || { e: 0, v: 0, n: 0 };
    b.e += eng(p); b.v += p.views || 0; b.n += 1;
    buckets.set(h, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => rate(b[1].e, b[1].v) - rate(a[1].e, a[1].v))
    .slice(0, 3).map(([h]) => h);
}

export function accountReport(ctx, key) {
  const acct = ctx.store.data.accounts[key];
  const posts = ctx.store.data.remote[key] || [];
  const now = Date.now();
  const week = posts.filter((p) => p.time > now - 7 * DAY);
  const sum = (f) => week.reduce((a, p) => a + (p[f] || 0), 0);
  const views = sum('views');
  const e = week.reduce((a, p) => a + eng(p), 0);

  const snaps = ctx.store.data.snapshots.filter((s) => s.key === key);
  const latest = snaps.at(-1);
  const base = snaps.find((s) => s.t >= now - 7.5 * DAY);
  let followers = latest ? `${fmtNum(latest.followers)}` : 'n/a';
  if (latest && base && latest.t - base.t >= DAY * 0.9) {
    const d = latest.followers - base.followers;
    followers += ` (${d >= 0 ? '+' : ''}${d} over ${Math.round((latest.t - base.t) / DAY)}d)`;
  }

  const lines = [
    `*${acct.owner} · ${acct.platform}* @${acct.username}`,
    `Followers: ${followers}`,
    `Last 7d: ${week.length} posts · ${fmtNum(views)} views · ${fmtNum(sum('likes'))} likes · ${fmtNum(sum('replies'))} comments/replies · eng. rate ${rate(e, views).toFixed(1)}%`,
  ];
  const top = [...week].sort((a, b) => eng(b) - eng(a))[0] || [...posts].sort((a, b) => eng(b) - eng(a))[0];
  if (top) lines.push(`Top post: "${clip(top.text, 50)}" – ${fmtNum(top.views)} views, ${fmtNum(top.likes)} likes`);
  const hrs = bestHours(posts, ctx.cfg.tz);
  if (hrs) lines.push(`Best posting hours: ${hrs.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}`);
  if (week.length < 3) lines.push(`⚠ Only ${week.length} post(s) this week – aim for 3+ to keep reach up.`);
  return lines.join('\n');
}

/** scope: owner name | 'all' */
export function report(ctx, scope = 'all') {
  const keys = connectedKeys(ctx).filter((k) => scope === 'all' || ctx.store.data.accounts[k].owner === scope);
  if (!keys.length) return 'No connected accounts yet. Send "connect threads <owner>" or "connect tiktok <owner>".';
  return keys.map((k) => accountReport(ctx, k)).join('\n\n');
}

/** Best local hours for an account, used to suggest posting slots. */
export function suggestHours(ctx, key) {
  return bestHours(ctx.store.data.remote[key] || [], ctx.cfg.tz) || [12, 19, 21];
}
