import crypto from 'node:crypto';
import { httpJson } from './util.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

export class WhatsApp {
  constructor(cfg, log = console.log) {
    this.cfg = cfg;
    this.log = log;
    this.sent = []; // dry-run outbox (also handy in tests)
  }

  get live() { return !this.cfg.dryRun && this.cfg.wa.token && this.cfg.wa.phoneId; }

  async sendText(to, body) {
    for (let i = 0; i < body.length || i === 0; i += 3500) {
      const chunk = body.slice(i, i + 3500);
      if (!this.live) {
        this.sent.push({ to, body: chunk });
        if (this.cfg.dryRun) this.log(`[WhatsApp → ${to}]\n${chunk}\n`);
        else this.log(`WhatsApp not configured; message to ${to} not sent`);
        continue;
      }
      await httpJson(`${GRAPH}/${this.cfg.wa.phoneId}/messages`, {
        method: 'POST', headers: { authorization: `Bearer ${this.cfg.wa.token}` },
        body: { messaging_product: 'whatsapp', to, type: 'text', text: { body: chunk, preview_url: false } },
      });
    }
  }

  async sendTemplate(to, text) {
    await httpJson(`${GRAPH}/${this.cfg.wa.phoneId}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${this.cfg.wa.token}` },
      body: {
        messaging_product: 'whatsapp', to, type: 'template',
        template: {
          name: this.cfg.wa.template, language: { code: this.cfg.wa.templateLang },
          components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s*\n+\s*/g, ' | ').slice(0, 1000) }] }],
        },
      },
    });
  }

  /** Push a message to every number registered for `owner`. Falls back to a template if the 24h chat window is closed. */
  async notify(owner, text) {
    for (const [num, o] of Object.entries(this.cfg.waAllowed)) {
      if (o !== owner) continue;
      try {
        await this.sendText(num, text);
      } catch (e) {
        if (this.cfg.wa.template) {
          try { await this.sendTemplate(num, text); continue; } catch (e2) { this.log(`WA template to ${num} failed: ${e2.message}`); }
        }
        this.log(`WA notify ${num} failed: ${e.message}`);
      }
    }
  }

  verifySignature(rawBody, header) {
    const secret = this.cfg.wa.appSecret;
    if (!secret) return false; // refuse unsigned traffic unless explicitly running dry
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(header || '');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Meta webhook payload -> [{ id, from, text }] */
  static parseIncoming(payload) {
    const out = [];
    for (const e of payload?.entry || []) {
      for (const c of e.changes || []) {
        for (const m of c.value?.messages || []) {
          if (m.type === 'text' && m.text?.body) out.push({ id: m.id, from: String(m.from).replace(/\D/g, ''), text: m.text.body });
        }
      }
    }
    return out;
  }
}
