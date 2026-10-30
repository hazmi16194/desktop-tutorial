import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({
  seq: 0,
  accounts: {},   // "owner:platform" -> { owner, platform, username, userId, accessToken, refreshToken, expiresAt, mock }
  posts: [],      // planned / published posts we manage
  remote: {},     // key -> latest posts pulled from the platform (with metrics)
  snapshots: [],  // follower history
  replies: [],    // incoming replies + suggestions
  rules: [],      // keyword auto-reply rules
  oauthStates: {},
  settings: { autoReply: false },
  meta: { replyBaseline: {}, lastDigest: '', seenMessages: [] },
});

/** Tiny JSON-file store. Single process, atomic writes, owner-only permissions (it holds OAuth tokens). */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    if (file && fs.existsSync(file)) {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data = { ...EMPTY(), ...loaded, settings: { ...EMPTY().settings, ...loaded.settings }, meta: { ...EMPTY().meta, ...loaded.meta } };
    }
  }

  update(fn) {
    const out = fn(this.data);
    this.flush();
    return out;
  }

  nextId() {
    this.data.seq += 1;
    return this.data.seq;
  }

  flush() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
