import { httpJson, DAY } from '../util.js';

const G = 'https://graph.threads.net';
const SCOPES = 'threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies,threads_manage_insights';

export function authUrl(cfg, state) {
  const q = new URLSearchParams({
    client_id: cfg.threads.appId, redirect_uri: `${cfg.baseUrl}/oauth/threads/callback`,
    scope: SCOPES, response_type: 'code', state,
  });
  return `https://threads.net/oauth/authorize?${q}`;
}

/** code -> short-lived token -> long-lived (60 day) token */
export async function exchangeCode(cfg, code) {
  const short = await httpJson(`${G}/oauth/access_token`, {
    method: 'POST',
    form: {
      client_id: cfg.threads.appId, client_secret: cfg.threads.appSecret, grant_type: 'authorization_code',
      redirect_uri: `${cfg.baseUrl}/oauth/threads/callback`, code,
    },
  });
  const q = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: cfg.threads.appSecret, access_token: short.access_token });
  const long = await httpJson(`${G}/access_token?${q}`);
  const me = await httpJson(`${G}/v1.0/me?${new URLSearchParams({ fields: 'id,username', access_token: long.access_token })}`);
  return { userId: me.id, username: me.username, accessToken: long.access_token, expiresAt: Date.now() + long.expires_in * 1000 };
}

export class ThreadsClient {
  constructor(acct, ctx) {
    this.acct = acct;
    this.ctx = ctx;
  }

  async token() {
    const a = this.acct;
    if (a.expiresAt - Date.now() < 7 * DAY) {
      const q = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: a.accessToken });
      const r = await httpJson(`${G}/refresh_access_token?${q}`);
      this.ctx.store.update(() => {
        a.accessToken = r.access_token;
        a.expiresAt = Date.now() + r.expires_in * 1000;
      });
    }
    return a.accessToken;
  }

  async get(path, params = {}) {
    const q = new URLSearchParams({ ...params, access_token: await this.token() });
    return httpJson(`${G}/v1.0/${path}?${q}`);
  }

  async post(path, params) {
    return httpJson(`${G}/v1.0/${path}`, { method: 'POST', form: { ...params, access_token: await this.token() } });
  }

  async stats() {
    const out = { followers: 0 };
    try {
      const r = await this.get(`${this.acct.userId}/threads_insights`, { metric: 'followers_count' });
      out.followers = r.data?.[0]?.total_value?.value ?? 0;
    } catch (e) {
      this.ctx.log(`threads followers ${this.acct.key}: ${e.message}`);
    }
    return out;
  }

  async listPosts(limit = 25) {
    const r = await this.get('me/threads', { fields: 'id,text,timestamp,permalink,media_type', limit });
    const posts = [];
    for (const p of r.data || []) {
      const m = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 };
      try {
        const ins = await this.get(`${p.id}/insights`, { metric: Object.keys(m).join(',') });
        for (const i of ins.data || []) m[i.name] = i.values?.[0]?.value ?? 0;
      } catch { /* insights are unavailable for reposts / very new posts */ }
      posts.push({ id: p.id, text: p.text || '', url: p.permalink, time: Date.parse(p.timestamp), ...m });
    }
    return posts;
  }

  async publish({ text, mediaUrl }) {
    if (!mediaUrl && (!text || text.length > 500)) throw new Error('Threads text must be 1-500 characters');
    const params = mediaUrl ? { media_type: 'IMAGE', image_url: mediaUrl, text } : { media_type: 'TEXT', text };
    const c = await this.post(`${this.acct.userId}/threads`, params);
    const p = await this.post(`${this.acct.userId}/threads_publish`, { creation_id: c.id });
    return { id: p.id };
  }

  async listReplies(postId) {
    const r = await this.get(`${postId}/replies`, { fields: 'id,text,username,timestamp' });
    return (r.data || []).map((x) => ({ id: x.id, from: x.username, text: x.text || '', time: Date.parse(x.timestamp) }));
  }

  async reply(replyToId, text) {
    const c = await this.post(`${this.acct.userId}/threads`, { media_type: 'TEXT', text, reply_to_id: replyToId });
    const p = await this.post(`${this.acct.userId}/threads_publish`, { creation_id: c.id });
    return { id: p.id };
  }
}
