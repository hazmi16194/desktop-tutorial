import crypto from 'node:crypto';
import * as threads from './platforms/threads.js';
import * as tiktok from './platforms/tiktok.js';
import { keyOf } from './platforms/index.js';

const MODS = { threads, tiktok };
const TTL = 15 * 60000;

/** Create a one-time link that connects `platform` for `owner`. Sent to the person over WhatsApp. */
export function startConnect(ctx, owner, platform) {
  const { cfg, store } = ctx;
  if (cfg.dryRun) {
    const key = keyOf(owner, platform);
    store.update((d) => {
      d.accounts[key] = { key, owner, platform, username: `${owner}_${platform}`, userId: key, mock: true, connectedAt: Date.now() };
    });
    return { done: true, message: `✅ (dry-run) ${platform} connected for ${owner}.` };
  }
  const creds = platform === 'threads' ? cfg.threads.appId && cfg.threads.appSecret : cfg.tiktok.clientKey && cfg.tiktok.clientSecret;
  if (!creds || !cfg.baseUrl) throw new Error(`${platform} app credentials or BASE_URL are not configured (see .env.example)`);
  const state = crypto.randomBytes(18).toString('hex');
  store.update((d) => {
    for (const [s, v] of Object.entries(d.oauthStates)) if (v.exp < Date.now()) delete d.oauthStates[s];
    d.oauthStates[state] = { owner, platform, exp: Date.now() + TTL };
  });
  return { done: false, url: MODS[platform].authUrl(cfg, state) };
}

/** Handles /oauth/<platform>/callback. Returns text shown to the browser + notifies the owner on WhatsApp. */
export async function finishConnect(ctx, platform, params) {
  const { store, cfg } = ctx;
  const st = store.data.oauthStates[params.get('state')];
  if (!st || st.platform !== platform || st.exp < Date.now()) throw new Error('This link expired or is invalid. Request a new one on WhatsApp.');
  if (params.get('error') || !params.get('code')) throw new Error('Authorization was cancelled.');
  const tok = await MODS[platform].exchangeCode(cfg, params.get('code'));
  const key = keyOf(st.owner, platform);
  store.update((d) => {
    delete d.oauthStates[params.get('state')];
    d.accounts[key] = { key, owner: st.owner, platform, connectedAt: Date.now(), ...tok };
  });
  await ctx.wa.notify(st.owner, `✅ ${platform} connected for ${st.owner} (@${tok.username}).`);
  return `Connected ${platform} as @${tok.username}. You can close this tab and go back to WhatsApp.`;
}
