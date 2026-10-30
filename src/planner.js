import { DAY, clip, fmtLocal, localParts } from './util.js';
import { getClient } from './platforms/index.js';
import { suggestHours } from './analytics.js';

export function createDraft(ctx, { key, text, mediaUrl, createdBy }) {
  const acct = ctx.store.data.accounts[key];
  if (!acct) throw new Error(`${key} is not connected`);
  return ctx.store.update((d) => {
    const post = {
      id: ctx.store.nextId(), key, owner: acct.owner, platform: acct.platform, text, mediaUrl: mediaUrl || null,
      status: 'draft', scheduledAt: null, createdBy, createdAt: Date.now(),
    };
    d.posts.push(post);
    return post;
  });
}

export function findPost(ctx, id) {
  const p = ctx.store.data.posts.find((x) => x.id === Number(id));
  if (!p) throw new Error(`No post #${id}`);
  return p;
}

export function schedule(ctx, id, when) {
  const p = findPost(ctx, id);
  if (!['draft', 'scheduled', 'failed'].includes(p.status)) throw new Error(`Post #${id} is ${p.status}`);
  if (when < Date.now() + 60000) throw new Error('That time is in the past – pick a future time.');
  ctx.store.update(() => { p.status = 'scheduled'; p.scheduledAt = when; p.error = undefined; });
  return p;
}

export function cancel(ctx, id) {
  const p = findPost(ctx, id);
  if (p.status === 'published' || p.status === 'publishing') throw new Error(`Post #${id} is already ${p.status}`);
  ctx.store.update(() => { p.status = 'cancelled'; });
  return p;
}

export async function publishNow(ctx, id) {
  const p = findPost(ctx, id);
  if (['published', 'publishing', 'cancelled'].includes(p.status)) throw new Error(`Post #${id} is ${p.status}`);
  ctx.store.update(() => { p.status = 'publishing'; });
  try {
    const r = await getClient(ctx, p.key).publish({ text: p.text, mediaUrl: p.mediaUrl });
    ctx.store.update(() => { p.status = 'published'; p.publishedAt = Date.now(); p.remoteId = r.id; p.note = r.note; });
  } catch (e) {
    ctx.store.update(() => { p.status = 'failed'; p.error = e.message; });
    throw e;
  }
  return p;
}

/** Publish everything whose time has come; tells the owner how it went. */
export async function runDue(ctx, now = Date.now()) {
  const due = ctx.store.data.posts.filter((p) => p.status === 'scheduled' && p.scheduledAt <= now);
  for (const p of due) {
    try {
      await publishNow(ctx, p.id);
      await ctx.wa.notify(p.owner, `✅ Published #${p.id} on ${p.platform} (${p.owner}): "${clip(p.text, 60)}"`);
    } catch (e) {
      await ctx.wa.notify(p.owner, `❌ Could not publish #${p.id} on ${p.platform}: ${e.message}\nFix and "schedule ${p.id} <date> <time>" again.`);
    }
  }
  return due.length;
}

/** Next 7 days: what's queued, drafts waiting, and days with nothing planned. */
export function plan(ctx, now = Date.now()) {
  const tz = ctx.cfg.tz;
  const { posts, accounts } = ctx.store.data;
  const lines = ['*Content plan – next 7 days*'];
  const scheduled = posts.filter((p) => p.status === 'scheduled' && p.scheduledAt < now + 7 * DAY).sort((a, b) => a.scheduledAt - b.scheduledAt);
  const days = new Map();
  for (let i = 0; i < 7; i++) days.set(localParts(now + i * DAY, tz).date, []);
  for (const p of scheduled) days.get(localParts(p.scheduledAt, tz).date)?.push(p);
  for (const [date, items] of days) {
    if (!items.length) { lines.push(`${date}: — nothing planned`); continue; }
    lines.push(`${date}:`);
    for (const p of items) lines.push(`  #${p.id} ${fmtLocal(p.scheduledAt, tz).split(' ').pop()} ${p.owner}/${p.platform} "${clip(p.text, 40)}"`);
  }
  const drafts = posts.filter((p) => p.status === 'draft');
  if (drafts.length) {
    lines.push('', '*Drafts waiting*');
    for (const p of drafts) lines.push(`  #${p.id} ${p.owner}/${p.platform} "${clip(p.text, 40)}"`);
  }
  const failed = posts.filter((p) => p.status === 'failed');
  if (failed.length) {
    lines.push('', '*Failed*');
    for (const p of failed) lines.push(`  #${p.id} ${p.owner}/${p.platform}: ${clip(p.error, 70)}`);
  }
  const hints = Object.keys(accounts).map((k) => `${k} → ${suggestHours(ctx, k).map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}`);
  if (hints.length) lines.push('', '*Suggested slots (from your best-performing hours)*', ...hints.map((h) => `  ${h}`));
  return lines.join('\n');
}
