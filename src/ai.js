import { httpJson } from './util.js';

/** Optional Claude helper for post ideas and reply drafts. Everything it writes is a suggestion that a human approves. */
export class AI {
  constructor(cfg) { this.cfg = cfg; }

  get enabled() { return Boolean(this.cfg.ai.key) && !this.cfg.dryRun; }

  async ask(system, user, maxTokens = 500) {
    const r = await httpJson('https://api.anthropic.com/v1/messages', {
      method: 'POST', timeout: 60000,
      headers: { 'x-api-key': this.cfg.ai.key, 'anthropic-version': '2023-06-01' },
      body: { model: this.cfg.ai.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
    });
    return (r.content || []).map((b) => b.text || '').join('').trim();
  }

  ideas(topic, platform, recentPosts = []) {
    const recent = recentPosts.slice(0, 5).map((p) => `- ${p.text}`).join('\n');
    return this.ask(
      `You are a social media strategist. Suggest 5 short, specific ${platform} post ideas with a hook each. No hashtags spam. Keep each under 3 lines.`,
      `Topic: ${topic}\nRecent posts (avoid repeating):\n${recent || '(none)'}`,
    );
  }

  draftReply(comment, postText) {
    return this.ask(
      'You write friendly, brief (under 200 characters), human-sounding replies to comments on a creator\'s post. No hashtags. If the comment is hostile, spam, or asks something you cannot know, answer with exactly: SKIP',
      `Post: ${postText}\nComment: ${comment}`, 150,
    );
  }
}
