import http from 'node:http';
import { WhatsApp } from './whatsapp.js';
import { finishConnect } from './oauth.js';

const MAX_BODY = 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const page = (title, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h2>${title}</h2><p>${msg.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</p>`;

export function createServer(ctx) {
  const { cfg } = ctx;

  async function onWebhook(raw) {
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return; }
    for (const m of WhatsApp.parseIncoming(payload)) {
      const seen = ctx.store.data.meta.seenMessages;
      if (seen.includes(m.id)) continue; // Meta retries deliveries
      ctx.store.update((d) => { d.meta.seenMessages = [...seen, m.id].slice(-200); });
      const reply = await ctx.handle(m.from, m.text);
      if (reply) await ctx.wa.sendText(m.from, reply).catch((e) => ctx.log(`reply send failed: ${e.message}`));
    }
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/health') { res.end('ok'); return; }

      if (url.pathname === '/webhook/whatsapp') {
        if (req.method === 'GET') {
          const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === cfg.wa.verifyToken && cfg.wa.verifyToken;
          res.statusCode = ok ? 200 : 403;
          res.end(ok ? url.searchParams.get('hub.challenge') : 'forbidden');
          return;
        }
        if (req.method === 'POST') {
          const raw = await readBody(req);
          if (!ctx.wa.verifySignature(raw, req.headers['x-hub-signature-256'])) { res.statusCode = 401; res.end('bad signature'); return; }
          res.statusCode = 200;
          res.end('ok'); // ack fast; Meta retries on slow responses
          onWebhook(raw).catch((e) => ctx.log(`webhook error: ${e.message}`));
          return;
        }
      }

      const m = url.pathname.match(/^\/oauth\/(threads|tiktok)\/callback$/);
      if (m && req.method === 'GET') {
        try {
          const msg = await finishConnect(ctx, m[1], url.searchParams);
          res.setHeader('content-type', 'text/html'); res.end(page('Connected ✅', msg));
        } catch (e) {
          ctx.log(`oauth ${m[1]} failed: ${e.message}`);
          res.statusCode = 400; res.setHeader('content-type', 'text/html'); res.end(page('Could not connect', e.message));
        }
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    } catch (e) {
      ctx.log(`server error: ${e.message}`);
      res.statusCode = 500;
      res.end('error');
    }
  });
}
