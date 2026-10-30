import { ThreadsClient } from './threads.js';
import { TikTokClient } from './tiktok.js';
import { MockClient } from './mock.js';

export const PLATFORMS = ['threads', 'tiktok'];
export const keyOf = (owner, platform) => `${owner}:${platform}`;

const cache = new Map();

export function getClient(ctx, key) {
  const acct = ctx.store.data.accounts[key];
  if (!acct) return null;
  const hit = cache.get(key);
  if (hit && hit.acct === acct) return hit.client;
  const Cls = acct.mock ? MockClient : acct.platform === 'threads' ? ThreadsClient : TikTokClient;
  const client = new Cls(acct, ctx);
  cache.set(key, { acct, client });
  return client;
}

export const connectedKeys = (ctx) => Object.keys(ctx.store.data.accounts);
