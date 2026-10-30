import { DAY, clip } from './util.js';
import { connectedKeys, getClient } from './platforms/index.js';

export function matchRule(rules, text) {
  const t = text.toLowerCase();
  return rules.find((r) => r.keywords.some((k) => t.includes(k)));
}

const sentToday = (ctx, key) =>
  ctx.store.data.replies.filter((r) => r.key === key && r.status === 'sent' && r.auto && r.sentAt > Date.now() - DAY).length;

/**
 * Looks for new replies on recent Threads posts. The first poll for an account only records a baseline,
 * so you are never spammed (or auto-replied to) for old conversations.
 * Returns [{ owner, text }] notifications to deliver.
 */
export async function pollReplies(ctx) {
  const notes = [];
  for (const key of connectedKeys(ctx)) {
    const acct = ctx.store.data.accounts[key];
    if (acct.platform !== 'threads') continue; // TikTok's API exposes no comments
    const client = getClient(ctx, key);
    try {
      const posts = (ctx.store.data.remote[key] || await client.listPosts(10)).slice(0, 10);
      const known = new Set(ctx.store.data.replies.map((r) => r.remoteId));
      const first = !ctx.store.data.meta.replyBaseline[key];
      const fresh = [];
      for (const p of posts) {
        for (const r of await client.listReplies(p.id)) {
          if (known.has(r.id) || r.from === acct.username) continue;
          known.add(r.id);
          fresh.push({ ...r, postId: p.id, postText: p.text });
        }
      }
      for (const r of fresh) {
        const rec = ctx.store.update((d) => {
          const x = {
            id: ctx.store.nextId(), key, owner: acct.owner, remoteId: r.id, postId: r.postId, postText: r.postText,
            from: r.from, text: r.text, status: first ? 'ignored' : 'pending', suggestion: null, source: null, createdAt: Date.now(),
          };
          d.replies.push(x);
          return x;
        });
        if (first) continue;
        const rule = matchRule(ctx.store.data.rules, r.text);
        if (rule) { rec.suggestion = rule.reply; rec.source = 'rule'; }
        else if (ctx.ai.enabled) {
          try {
            const s = await ctx.ai.draftReply(r.text, r.postText);
            if (s && s !== 'SKIP') { rec.suggestion = s; rec.source = 'ai'; }
          } catch (e) { ctx.log(`ai draft failed: ${e.message}`); }
        }
        // Only rule-based replies are ever sent unattended; AI drafts always wait for a human.
        if (ctx.store.data.settings.autoReply && rec.source === 'rule' && sentToday(ctx, key) < ctx.cfg.autoReplyDailyCap) {
          try {
            await sendReply(ctx, rec.id, rec.suggestion, true);
            notes.push({ owner: acct.owner, text: `🤖 Auto-replied to @${rec.from} on ${acct.platform}: "${clip(rec.suggestion, 80)}"` });
            continue;
          } catch (e) { ctx.log(`auto reply failed: ${e.message}`); }
        }
        notes.push({ owner: acct.owner, text: formatPending(rec) });
      }
      ctx.store.update((d) => { d.meta.replyBaseline[key] = Date.now(); });
    } catch (e) {
      ctx.log(`pollReplies ${key} failed: ${e.message}`);
    }
  }
  return notes;
}

export function formatPending(r) {
  const sug = r.suggestion ? `Suggested${r.source === 'ai' ? ' (AI)' : ''}: "${r.suggestion}"\n→ *send ${r.id}* to post it · *skip ${r.id}* to ignore` : `→ *send ${r.id} <your reply>* · *skip ${r.id}*`;
  return `💬 @${r.from} on ${r.owner}/threads:\n"${clip(r.text, 160)}"\n${sug}`;
}

export function pendingList(ctx, owner) {
  return ctx.store.data.replies.filter((r) => r.status === 'pending' && (!owner || r.owner === owner));
}

export async function sendReply(ctx, id, text, auto = false) {
  const r = ctx.store.data.replies.find((x) => x.id === Number(id));
  if (!r) throw new Error(`No reply #${id}`);
  if (r.status === 'sent') throw new Error(`Reply #${id} was already answered`);
  if (!text) throw new Error(`Reply #${id} has no suggestion – use: send ${id} <your reply>`);
  await getClient(ctx, r.key).reply(r.remoteId, text);
  ctx.store.update(() => { r.status = 'sent'; r.sentText = text; r.sentAt = Date.now(); r.auto = auto; });
  return r;
}

export function skipReply(ctx, id) {
  const r = ctx.store.data.replies.find((x) => x.id === Number(id));
  if (!r) throw new Error(`No reply #${id}`);
  ctx.store.update(() => { r.status = 'ignored'; });
  return r;
}
