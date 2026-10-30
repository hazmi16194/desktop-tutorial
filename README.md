# Social HQ

A master social-media manager for **your and your wife's TikTok + Threads accounts**, run entirely from **WhatsApp**.

| Capability | What it does |
|---|---|
| **Analysis** | Followers + 7-day trend, views / likes / comments, engagement rate, top post, best posting hours – per account or combined. Daily digest pushed to WhatsApp each morning. |
| **Planning** | Draft → schedule → auto-publish queue, 7-day calendar with empty days flagged, suggested slots based on your best-performing hours. |
| **Post automation** | Scheduled posts publish themselves and report back on WhatsApp (✅ / ❌). |
| **Reply automation** | New Threads replies are pushed to WhatsApp with a suggested answer (keyword rules, or Claude drafts). You reply `send 12` / `skip 12`. Optional `auto on` sends rule-matched replies by itself, capped per day. |
| **WhatsApp control** | Every feature is a text command. Only the numbers you whitelist can use it. |

## Try it in 30 seconds (no keys needed)

```bash
npm run demo     # fake WhatsApp in your terminal with simulated accounts
npm test         # 12 tests
```

Try: `status`, `stats`, `draft threads me Hello world`, `schedule 1 tomorrow 19:00`, `plan`, `rule add price => Link in bio`, `:reply what's the price?`, `send 2`, `as wife: stats`.

## WhatsApp commands

```
stats [owner|all]                              analytics
plan                                           next 7 days, drafts, best slots
draft threads <owner> <text>                   new Threads draft
draft tiktok <owner> <https-video-url> <caption>
schedule <id> <YYYY-MM-DD|today|tomorrow> <HH:mm>   (in TIMEZONE)
approve <id>   cancel <id>                     publish now / drop
replies   send <id> [text]   skip <id>         handle incoming replies
auto on|off                                    auto-send rule-matched replies
rule add kw1,kw2 => reply   rules   rule del <n>
ideas <topic> [threads|tiktok]                 AI post ideas (needs ANTHROPIC_API_KEY)
connect threads|tiktok <owner>                 get the one-time login link
status   refresh   help
```

`<owner>` is a name from `OWNERS` (e.g. `hazmi`, `wife`) or `me`.

## Going live

You need four things from Meta/TikTok. All are free; the approval steps are the slow part.

1. **Server with public HTTPS** – any small VPS/Fly/Railway/Render. `cp .env.example .env`, fill it in, `npm start`. Set `BASE_URL`. Data lives in `data/db.json` (OAuth tokens inside, file is `0600`, git-ignored – back it up).
2. **WhatsApp Cloud API** – developers.facebook.com → create app → add WhatsApp. Copy the token + phone-number ID to `WA_TOKEN` / `WA_PHONE_ID`, app secret to `WA_APP_SECRET`. Webhook URL: `{BASE_URL}/webhook/whatsapp`, verify token = `WA_VERIFY_TOKEN`, subscribe to `messages`. Put both phone numbers in `WA_ALLOWED`.
3. **Threads API** – same Meta developer portal, "Access the Threads API" use case. Redirect URI: `{BASE_URL}/oauth/threads/callback`. Add you and your wife as app testers (Threads Tester role) – no app review needed for your own accounts.
4. **TikTok for Developers** – create an app with Login Kit + Content Posting API. Redirect URI: `{BASE_URL}/oauth/tiktok/callback`. Add both of you as sandbox/target users.

Then message the bot `connect threads hazmi`, `connect tiktok hazmi`, and the same for `wife` – you each tap the link and log in once. Tokens refresh automatically.

## Know these limits before you rely on it

- **TikTok replies are not possible via API.** TikTok's public API has no comment endpoints, so reply automation is **Threads only**. TikTok gets analytics + posting.
- **TikTok posting caveats.** Unaudited apps can only post as `SELF_ONLY` (private) – set `TIKTOK_PRIVACY=PUBLIC_TO_EVERYONE` after TikTok approves your audit. The video is pulled from a URL, and that URL's domain/prefix must be verified in the TikTok portal, so host videos on a domain you control.
- **WhatsApp's 24-hour window.** The bot can message you freely only within 24h of your last message to it. For the morning digest on days you didn't write, Meta requires an approved *template*: create one with a single `{{1}}` body variable, put its name in `WA_TEMPLATE_NAME`. Without it, digests only arrive if you chatted recently.
- **Threads tokens** last 60 days and are refreshed automatically when within 7 days of expiry; if the server is down for a long stretch you'll need to `connect` again.
- **Analytics freshness.** Metrics are pulled hourly (and on every `stats`). Insights are limited to what each platform exposes.
- **Not included:** WhatsApp voice notes / media upload (video must be a URL), image carousels, multi-image Threads posts.

## Safety defaults

- Messages from numbers not in `WA_ALLOWED` are silently ignored; webhook payloads must carry a valid Meta signature (`WA_APP_SECRET`).
- Nothing posts without an explicit command (`approve` / `schedule`).
- Auto-reply is **off** by default. When on, only your own keyword rules send unattended, capped by `AUTO_REPLY_DAILY_CAP`; AI drafts always wait for your `send`.
- The first reply poll for an account only records a baseline – old comments never trigger notifications or auto-replies.
- `CROSS_ACCESS=false` limits each of you to your own accounts.

## Layout

```
src/platforms/   threads.js · tiktok.js · mock.js   (API clients)
src/commands.js  WhatsApp command parser/handler
src/analytics.js · planner.js · replies.js · scheduler.js
src/whatsapp.js  send / webhook parsing / signature check
src/server.js    webhook + OAuth callbacks · src/index.js entry · src/cli.js demo
```
