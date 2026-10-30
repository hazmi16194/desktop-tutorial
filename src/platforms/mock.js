// Simulated platform used in DRY_RUN / demo / tests. Deterministic enough to be testable.
const state = new Map();

function get(key) {
  if (!state.has(key)) {
    const hash = [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const now = Date.now();
    const posts = Array.from({ length: 8 }, (_, i) => {
      const views = 800 + ((hash >>> i) % 5000);
      return {
        id: `${key}-p${i}`, text: `Sample post ${i + 1} for ${key}`, url: `https://example.com/${key}/${i}`,
        time: now - (i * 22 + 5) * 3600000 - (i % 3) * 7 * 3600000,
        views, likes: Math.round(views * 0.05), replies: Math.round(views * 0.006), reposts: Math.round(views * 0.01), shares: Math.round(views * 0.004),
      };
    });
    state.set(key, { followers: 1000 + (hash % 4000), posts, incoming: [], sent: [] });
  }
  return state.get(key);
}

export function mockInjectReply(key, text, from = 'fan') {
  const s = get(key);
  s.incoming.push({ id: `${key}-r${s.incoming.length + 1}-${Date.now()}`, from, text, time: Date.now() });
}

export function mockReset() { state.clear(); }
export const mockSent = (key) => get(key).sent;

export class MockClient {
  constructor(acct) { this.key = acct.key; this.platform = acct.platform; }
  async stats() { const s = get(this.key); s.followers += 3; return { followers: s.followers }; }
  async listPosts() { return get(this.key).posts; }
  async publish({ text, mediaUrl }) {
    const s = get(this.key);
    if (this.platform === 'tiktok' && !mediaUrl) throw new Error('TikTok posts need a video URL');
    const id = `${this.key}-new${s.posts.length}`;
    s.posts.unshift({ id, text, url: `https://example.com/${id}`, time: Date.now(), views: 0, likes: 0, replies: 0, reposts: 0, shares: 0 });
    return { id };
  }
  // all simulated replies hang off the newest post
  async listReplies(postId) { const s = get(this.key); return this.platform === 'threads' && postId === s.posts[0].id ? s.incoming : []; }
  async reply(replyToId, text) {
    if (this.platform !== 'threads') throw new Error('TikTok API does not support replying to comments');
    get(this.key).sent.push({ replyToId, text });
    return { id: `sent-${Date.now()}` };
  }
}
