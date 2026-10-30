import { clip, fmtLocal, localToUtc, resolveDate } from './util.js';
import { PLATFORMS, keyOf } from './platforms/index.js';
import { report, collect } from './analytics.js';
import * as planner from './planner.js';
import * as replies from './replies.js';
import { startConnect } from './oauth.js';

const HELP = `*Social HQ* – commands
*stats* [owner|all] – analytics (alias: report)
*plan* – next 7 days + drafts + best slots
*draft threads <owner> <text>* – new Threads draft
*draft tiktok <owner> <video-url> <caption>* – new TikTok draft
*schedule <id> <YYYY-MM-DD|today|tomorrow> <HH:mm>*
*approve <id>* – publish now · *cancel <id>*
*replies* – pending replies · *send <id> [text]* · *skip <id>*
*auto on|off* – auto-send rule-based replies
*rule add kw1,kw2 => reply text* · *rules* · *rule del <n>*
*ideas <topic>* [threads|tiktok] – AI post ideas
*connect threads|tiktok <owner>* · *status* · *refresh*
"me" works as an owner name.`;

const err = (m) => `⚠ ${m}`;

export function createCommandHandler(ctx) {
  const { cfg, store } = ctx;

  const senderOwner = (from) => cfg.waAllowed[from];
  const owner = (tok, sender) => {
    const t = (tok || '').toLowerCase();
    if (t === 'me') return sender;
    if (!cfg.owners.includes(t)) throw new Error(`Unknown owner "${tok}". Use: ${cfg.owners.join(', ')} or me`);
    return t;
  };
  const guard = (sender, target) => {
    if (target !== sender && !cfg.crossAccess) throw new Error(`You can only manage your own accounts (${sender}).`);
  };

  async function run(sender, text) {
    const parts = text.trim().split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase().replace(/^[/!]/, '');

    switch (cmd) {
      case '': case 'help': case 'menu': case 'hi': case 'hello':
        return HELP;

      case 'status': {
        const rows = [];
        for (const o of cfg.owners) {
          for (const p of PLATFORMS) {
            const a = store.data.accounts[keyOf(o, p)];
            rows.push(`${a ? '🟢' : '⚪'} ${o}/${p}${a ? ` @${a.username}` : ' – not connected'}`);
          }
        }
        const c = store.data.posts;
        rows.push('', `Queue: ${c.filter((p) => p.status === 'scheduled').length} scheduled, ${c.filter((p) => p.status === 'draft').length} drafts`);
        rows.push(`Pending replies: ${replies.pendingList(ctx).length} · Auto-reply: ${store.data.settings.autoReply ? 'ON' : 'off'} · AI: ${ctx.ai.enabled ? 'on' : 'off'}`);
        return rows.join('\n');
      }

      case 'stats': case 'report': case 'analytics': {
        const scope = parts[0] && parts[0].toLowerCase() !== 'all' ? owner(parts[0], sender) : 'all';
        await collect(ctx);
        return report(ctx, scope);
      }

      case 'refresh':
        await collect(ctx);
        return 'Refreshed analytics.';

      case 'plan': case 'calendar':
        return planner.plan(ctx);

      case 'connect': {
        const platform = (parts[0] || '').toLowerCase();
        if (!PLATFORMS.includes(platform)) return err('Usage: connect threads|tiktok <owner>');
        const o = owner(parts[1] || 'me', sender);
        guard(sender, o);
        const r = startConnect(ctx, o, platform);
        return r.done ? r.message : `Open this link (valid 15 min) and log in as *${o}*'s ${platform} account:\n${r.url}`;
      }

      case 'draft': case 'post': {
        const platform = (parts[0] || '').toLowerCase();
        if (!PLATFORMS.includes(platform) || parts.length < 3) return err('Usage: draft threads <owner> <text>  |  draft tiktok <owner> <video-url> <caption>');
        const o = owner(parts[1], sender);
        guard(sender, o);
        let body = parts.slice(2).join(' ');
        let mediaUrl = null;
        if (platform === 'tiktok') {
          mediaUrl = parts[2];
          if (!/^https:\/\//.test(mediaUrl)) return err('TikTok needs a https:// video URL right after the owner name.');
          body = parts.slice(3).join(' ');
        }
        const key = keyOf(o, platform);
        if (!store.data.accounts[key]) return err(`${o}/${platform} is not connected. Send: connect ${platform} ${o}`);
        if (platform === 'threads' && body.length > 500) return err(`Threads limit is 500 characters (yours: ${body.length}).`);
        const p = planner.createDraft(ctx, { key, text: body, mediaUrl, createdBy: sender });
        return `📝 Draft #${p.id} for ${o}/${platform}:\n"${clip(body, 200)}"\n→ *approve ${p.id}* to publish now, or *schedule ${p.id} tomorrow 19:00*`;
      }

      case 'schedule': {
        const [id, d, t] = parts;
        const date = resolveDate(d, cfg.tz);
        if (!id || !date || !/^\d{1,2}:\d{2}$/.test(t || '')) return err('Usage: schedule <id> <YYYY-MM-DD|today|tomorrow> <HH:mm>  (time in ' + cfg.tz + ')');
        const post = planner.findPost(ctx, id);
        guard(sender, post.owner);
        const when = localToUtc(date, t, cfg.tz);
        planner.schedule(ctx, id, when);
        return `🗓 #${id} scheduled for ${fmtLocal(when, cfg.tz)} (${post.owner}/${post.platform}).`;
      }

      case 'approve': case 'publish': {
        const post = planner.findPost(ctx, parts[0]);
        guard(sender, post.owner);
        await planner.publishNow(ctx, post.id);
        return `✅ Published #${post.id} on ${post.owner}/${post.platform}.`;
      }

      case 'cancel': {
        const post = planner.findPost(ctx, parts[0]);
        guard(sender, post.owner);
        planner.cancel(ctx, post.id);
        return `🗑 Cancelled #${post.id}.`;
      }

      case 'replies': {
        const list = replies.pendingList(ctx, cfg.crossAccess ? undefined : sender).slice(0, 8);
        return list.length ? list.map(replies.formatPending).join('\n\n') : 'No replies waiting 🎉';
      }

      case 'send': {
        const r = store.data.replies.find((x) => x.id === Number(parts[0]));
        if (!r) return err(`No reply #${parts[0]}`);
        guard(sender, r.owner);
        const custom = parts.slice(1).join(' ');
        await replies.sendReply(ctx, r.id, custom || r.suggestion);
        return `✅ Replied to @${r.from}.`;
      }

      case 'skip': {
        const r = replies.skipReply(ctx, parts[0]);
        guard(sender, r.owner);
        return `⏭ Skipped #${r.id}.`;
      }

      case 'auto': {
        const v = (parts[0] || '').toLowerCase();
        if (!['on', 'off'].includes(v)) return err('Usage: auto on|off');
        store.update((d) => { d.settings.autoReply = v === 'on'; });
        return v === 'on'
          ? `🤖 Auto-reply ON for rule matches only (max ${cfg.autoReplyDailyCap}/account/day). AI drafts still need your approval.`
          : '🛑 Auto-reply OFF. Everything waits for your approval.';
      }

      case 'rule': {
        const sub = (parts[0] || '').toLowerCase();
        if (sub === 'del') {
          const idx = Number(parts[1]) - 1;
          if (!store.data.rules[idx]) return err('No such rule. See: rules');
          store.update((d) => d.rules.splice(idx, 1));
          return 'Rule deleted.';
        }
        if (sub === 'add') {
          const m = text.replace(/^\S+\s+\S+\s*/, '').match(/^(.+?)\s*=>\s*(.+)$/s);
          if (!m) return err('Usage: rule add thanks,love => Thank you so much! 💛');
          const keywords = m[1].split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
          store.update((d) => d.rules.push({ keywords, reply: m[2].trim() }));
          return `Rule added: [${keywords.join(', ')}] → "${m[2].trim()}"`;
        }
        return err('Usage: rule add kw1,kw2 => reply  |  rule del <n>');
      }

      case 'rules': {
        const r = store.data.rules;
        return r.length ? r.map((x, i) => `${i + 1}. [${x.keywords.join(', ')}] → ${x.reply}`).join('\n') : 'No rules yet. Example: rule add price,cost => Check the link in my bio 🙌';
      }

      case 'ideas': {
        if (!ctx.ai.enabled) return err('Set ANTHROPIC_API_KEY to enable AI ideas.');
        const last = parts.at(-1)?.toLowerCase();
        const platform = PLATFORMS.includes(last) ? last : 'threads';
        const topic = (PLATFORMS.includes(last) ? parts.slice(0, -1) : parts).join(' ');
        if (!topic) return err('Usage: ideas <topic> [threads|tiktok]');
        const recent = Object.values(store.data.remote).flat().filter(Boolean);
        return ctx.ai.ideas(topic, platform, recent);
      }

      default:
        return `I didn't get "${cmd}". Send *help* to see what I can do.`;
    }
  }

  /** Entry point for an incoming WhatsApp message. Never throws. */
  return async function handle(from, text) {
    const sender = senderOwner(from);
    if (!sender) {
      ctx.log(`Ignored message from unlisted number ${from}`);
      return null; // silently ignore strangers
    }
    try {
      return await run(sender, text);
    } catch (e) {
      ctx.log(`command error: ${e.message}`);
      return err(e.message);
    }
  };
}
