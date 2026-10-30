import { httpJson } from '../util.js';

const API = 'https://open.tiktokapis.com/v2';
const SCOPES = 'user.info.basic,user.info.stats,video.list,video.publish';

export function authUrl(cfg, state) {
  const q = new URLSearchParams({
    client_key: cfg.tiktok.clientKey, scope: SCOPES, response_type: 'code',
    redirect_uri: `${cfg.baseUrl}/oauth/tiktok/callback`, state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

function checkErr(r) {
  if (r.error?.code && r.error.code !== 'ok') throw new Error(`TikTok: ${r.error.code} ${r.error.message || ''}`);
  return r;
}

async function tokenCall(cfg, form) {
  const r = await httpJson(`${API}/oauth/token/`, {
    method: 'POST', form: { client_key: cfg.tiktok.clientKey, client_secret: cfg.tiktok.clientSecret, ...form },
  });
  if (r.error) throw new Error(`TikTok token: ${r.error} ${r.error_description || ''}`);
  return r;
}

export async function exchangeCode(cfg, code) {
  const t = await tokenCall(cfg, { grant_type: 'authorization_code', code, redirect_uri: `${cfg.baseUrl}/oauth/tiktok/callback` });
  const me = await httpJson(`${API}/user/info/?fields=open_id,display_name,username`, { headers: { authorization: `Bearer ${t.access_token}` } });
  const u = checkErr(me).data?.user || {};
  return {
    userId: t.open_id, username: u.username || u.display_name || t.open_id,
    accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000,
  };
}

export class TikTokClient {
  constructor(acct, ctx) {
    this.acct = acct;
    this.ctx = ctx;
  }

  async token() {
    const a = this.acct;
    if (a.expiresAt - Date.now() < 5 * 60000) {
      const r = await tokenCall(this.ctx.cfg, { grant_type: 'refresh_token', refresh_token: a.refreshToken });
      this.ctx.store.update(() => {
        a.accessToken = r.access_token;
        a.refreshToken = r.refresh_token || a.refreshToken;
        a.expiresAt = Date.now() + r.expires_in * 1000;
      });
    }
    return a.accessToken;
  }

  async call(path, opts = {}) {
    const headers = { authorization: `Bearer ${await this.token()}` };
    return checkErr(await httpJson(`${API}${path}`, { ...opts, headers }));
  }

  async stats() {
    const r = await this.call('/user/info/?fields=follower_count,following_count,likes_count,video_count');
    const u = r.data?.user || {};
    return { followers: u.follower_count ?? 0, likesTotal: u.likes_count ?? 0, videoCount: u.video_count ?? 0 };
  }

  async listPosts(limit = 20) {
    const fields = 'id,title,create_time,share_url,view_count,like_count,comment_count,share_count';
    const r = await this.call(`/video/list/?fields=${fields}`, { method: 'POST', body: { max_count: Math.min(limit, 20) } });
    return (r.data?.videos || []).map((v) => ({
      id: v.id, text: v.title || '', url: v.share_url, time: v.create_time * 1000,
      views: v.view_count || 0, likes: v.like_count || 0, replies: v.comment_count || 0, shares: v.share_count || 0,
    }));
  }

  /** TikTok posts need a video. mediaUrl must be on a URL prefix verified in the TikTok developer portal. */
  async publish({ text, mediaUrl }) {
    if (!mediaUrl) throw new Error('TikTok posts need a video URL');
    const r = await this.call('/post/publish/video/init/', {
      method: 'POST',
      body: {
        post_info: { title: (text || '').slice(0, 2200), privacy_level: this.ctx.cfg.tiktok.privacy, disable_comment: false },
        source_info: { source: 'PULL_FROM_URL', video_url: mediaUrl },
      },
    });
    const publishId = r.data.publish_id;
    for (let i = 0; i < 6; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      const s = await this.call('/post/publish/status/fetch/', { method: 'POST', body: { publish_id: publishId } });
      const st = s.data?.status;
      if (st === 'FAILED') throw new Error(`TikTok publish failed: ${s.data.fail_reason || 'unknown'}`);
      if (st === 'PUBLISH_COMPLETE') return { id: publishId };
    }
    return { id: publishId, note: 'still processing on TikTok' };
  }

  // TikTok's Login Kit API has no comment endpoints, so there is nothing to read or reply to here.
  async listReplies() { return []; }
  async reply() { throw new Error('TikTok API does not support replying to comments'); }
}
