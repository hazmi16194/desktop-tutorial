import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { startConnect } from '../src/oauth.js';
import { PLATFORMS } from '../src/platforms/index.js';
import { mockInjectReply, mockReset, mockSent } from '../src/platforms/mock.js';
import { pollAndNotify, dailyDigest } from '../src/scheduler.js';
import { runDue } from '../src/planner.js';
import { localToUtc, localParts } from '../src/util.js';
import { createServer } from '../src/server.js';

const HAZMI = '60100000001';
const WIFE = '60100000002';
const STRANGER = '60999999999';

function setup(extra = {}) {
  mockReset();
  const cfg = loadConfig({ DRY_RUN: '1', OWNERS: 'hazmi,wife', WA_ALLOWED: `${HAZMI}:hazmi,${WIFE}:wife`, TIMEZONE: 'Asia/Kuala_Lumpur', WA_APP_SECRET: 's3cret', WA_VERIFY_TOKEN: 'vt', ...extra });
  cfg.dryRun = true;
  const ctx = createContext(cfg, { persist: false, log: () => {} });
  ctx.wa.log = () => {};
  for (const o of cfg.owners) for (const p of PLATFORMS) startConnect(ctx, o, p);
  return ctx;
}

let ctx;
beforeEach(() => { ctx = setup(); });

test('timezone conversion: KL 19:00 is 11:00 UTC', () => {
  assert.equal(new Date(localToUtc('2026-11-01', '19:00', 'Asia/Kuala_Lumpur')).toISOString(), '2026-11-01T11:00:00.000Z');
  assert.equal(localParts(Date.parse('2026-11-01T11:00:00Z'), 'Asia/Kuala_Lumpur').hour, 19);
});

test('strangers are ignored, owners get help', async () => {
  assert.equal(await ctx.handle(STRANGER, 'stats'), null);
  assert.match(await ctx.handle(HAZMI, 'help'), /Social HQ/);
});

test('draft -> schedule -> runDue publishes and notifies the owner', async () => {
  const d = await ctx.handle(HAZMI, 'draft threads me Hello from the test');
  assert.match(d, /Draft #1/);
  assert.match(await ctx.handle(HAZMI, 'schedule 1 tomorrow 19:00'), /scheduled/);
  assert.equal(await runDue(ctx), 0, 'not due yet');
  assert.equal(await runDue(ctx, Date.now() + 3 * 86400000), 1);
  assert.equal(ctx.store.data.posts[0].status, 'published');
  assert.ok(ctx.wa.sent.some((m) => m.to === HAZMI && /Published #1/.test(m.body)));
  assert.equal(await runDue(ctx, Date.now() + 4 * 86400000), 0, 'never publishes twice');
});

test('validation: past time, long threads text, tiktok needs https video', async () => {
  await ctx.handle(HAZMI, 'draft threads me hi');
  assert.match(await ctx.handle(HAZMI, 'schedule 1 2020-01-01 10:00'), /past/);
  assert.match(await ctx.handle(HAZMI, 'draft threads me ' + 'x'.repeat(501)), /500/);
  assert.match(await ctx.handle(HAZMI, 'draft tiktok me notaurl caption'), /https/);
  assert.match(await ctx.handle(HAZMI, 'draft tiktok wife https://cdn.example.com/v.mp4 my caption'), /Draft #2/);
});

test('publishing a tiktok draft works through the mock, failures are reported not thrown', async () => {
  await ctx.handle(HAZMI, 'draft tiktok wife https://cdn.example.com/v.mp4 cap');
  assert.match(await ctx.handle(HAZMI, 'approve 1'), /Published/);
  assert.match(await ctx.handle(HAZMI, 'approve 1'), /published/); // already published -> warning
});

test('cross access can be disabled', async () => {
  const c = setup({ CROSS_ACCESS: 'false' });
  assert.match(await c.handle(HAZMI, 'draft threads wife hi'), /only manage your own/);
  assert.match(await c.handle(HAZMI, 'draft threads me hi'), /Draft #1/);
});

test('stats report covers every account and plan lists queue + slots', async () => {
  const s = await ctx.handle(HAZMI, 'stats');
  for (const k of ['hazmi · threads', 'hazmi · tiktok', 'wife · threads', 'wife · tiktok']) assert.ok(s.includes(k), k);
  assert.match(await ctx.handle(HAZMI, 'stats wife'), /wife/);
  assert.doesNotMatch(await ctx.handle(HAZMI, 'stats wife'), /hazmi ·/);
  assert.match(await ctx.handle(HAZMI, 'plan'), /Content plan/);
});

test('replies: first poll is a baseline, later replies are suggested via rules, nothing auto-sends by default', async () => {
  mockInjectReply('hazmi:threads', 'old comment from before connecting');
  await pollAndNotify(ctx);
  assert.equal(ctx.store.data.replies.filter((r) => r.status === 'pending').length, 0);

  await ctx.handle(HAZMI, 'rule add price,cost => Link is in my bio 🙌');
  mockInjectReply('hazmi:threads', 'How much is the PRICE?', 'buyer1');
  await pollAndNotify(ctx);
  const pending = ctx.store.data.replies.find((r) => r.status === 'pending');
  assert.equal(pending.suggestion, 'Link is in my bio 🙌');
  assert.ok(ctx.wa.sent.some((m) => m.to === HAZMI && /@buyer1/.test(m.body)));
  assert.equal(mockSent('hazmi:threads').length, 0, 'no auto reply while auto is off');

  assert.match(await ctx.handle(HAZMI, `send ${pending.id}`), /Replied/);
  assert.equal(mockSent('hazmi:threads')[0].text, 'Link is in my bio 🙌');
  assert.match(await ctx.handle(HAZMI, `send ${pending.id}`), /already/);
});

test('auto-reply: only rule matches, respects daily cap', async () => {
  const c = setup({ AUTO_REPLY_DAILY_CAP: '2' });
  await pollAndNotify(c);
  await c.handle(HAZMI, 'rule add thanks => You are welcome!');
  await c.handle(HAZMI, 'auto on');
  for (let i = 0; i < 3; i++) mockInjectReply('hazmi:threads', `thanks #${i}`, `u${i}`);
  mockInjectReply('hazmi:threads', 'something unrelated', 'u9');
  await pollAndNotify(c);
  assert.equal(mockSent('hazmi:threads').length, 2, 'cap of 2 enforced');
  assert.equal(c.store.data.replies.filter((r) => r.status === 'pending').length, 2, 'over-cap + unmatched wait for a human');
});

test('rule syntax errors and skip', async () => {
  assert.match(await ctx.handle(HAZMI, 'rule add nokeywordarrow'), /Usage/);
  await pollAndNotify(ctx);
  mockInjectReply('wife:threads', 'hello there', 'z');
  await pollAndNotify(ctx);
  const r = ctx.store.data.replies.find((x) => x.status === 'pending');
  assert.match(await ctx.handle(HAZMI, `skip ${r.id}`), /Skipped/);
  assert.match(await ctx.handle(HAZMI, `send ${r.id} hi`), /Replied|already/);
});

test('daily digest fires once per day in the configured hour', async () => {
  const hour = 8;
  const at = localToUtc('2026-11-02', '08:05', 'Asia/Kuala_Lumpur');
  assert.equal(ctx.cfg.digestHour, hour);
  assert.equal(await dailyDigest(ctx, at), true);
  assert.equal(await dailyDigest(ctx, at + 60000), false);
  assert.ok(ctx.wa.sent.some((m) => m.to === WIFE && /Daily digest/.test(m.body)));
  assert.equal(await dailyDigest(ctx, localToUtc('2026-11-02', '12:00', 'Asia/Kuala_Lumpur')), false);
});

test('webhook: verification handshake, bad signature rejected, signed message handled once', async () => {
  const server = createServer(ctx);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42`)).status, 200);
    assert.equal((await fetch(`${base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`)).status, 403);

    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: HAZMI, type: 'text', text: { body: 'status' } }] } }] }] });
    assert.equal((await fetch(`${base}/webhook/whatsapp`, { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=bad' } })).status, 401);

    const sig = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(body).digest('hex');
    for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base}/webhook/whatsapp`, { method: 'POST', body, headers: { 'x-hub-signature-256': sig } })).status, 200);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(ctx.wa.sent.filter((m) => m.to === HAZMI && /hazmi\/threads/.test(m.body)).length, 1, 'duplicate delivery ignored');
  } finally {
    server.close();
  }
});
