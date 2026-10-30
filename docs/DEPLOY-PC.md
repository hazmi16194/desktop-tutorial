# Run Social HQ on your own PC

Goal: the app runs on your PC and a tunnel gives it a **fixed public HTTPS address**, which WhatsApp, Threads and TikTok need.

> The PC must stay on and awake for scheduled posts, digests and reply checks to work.

## 1. Install and test (5 min)

1. Install **Node.js 20+** (https://nodejs.org) and **Git**.
2. ```bash
   git clone https://github.com/hazmi16194/desktop-tutorial.git
   cd desktop-tutorial
   git checkout claude/social-media-manager-tiktok-threads-2flh10
   npm test        # should say: pass 12
   npm run demo    # try the commands with a fake WhatsApp
   ```

## 2. Get a fixed public address

The address must **not change**, because you register it with Meta and TikTok. Pick one:

**A. ngrok free static domain (easiest, no own domain needed)**
1. Sign up at https://ngrok.com, install it, run `ngrok config add-authtoken <token>`.
2. In the ngrok dashboard, claim your free static domain (e.g. `your-name.ngrok-free.app`). Check ngrok's current free-plan terms.
3. Run: `ngrok http --url=your-name.ngrok-free.app 3000`
4. `BASE_URL=https://your-name.ngrok-free.app`

**B. Cloudflare Tunnel (needs a domain you own, about US$10/year, nothing else)**
1. Add your domain to Cloudflare (free plan).
2. Install `cloudflared`, then `cloudflared tunnel login`, `cloudflared tunnel create socialhq`.
3. `cloudflared tunnel route dns socialhq social.yourdomain.com`
4. Run: `cloudflared tunnel run --url http://localhost:3000 socialhq`
5. `BASE_URL=https://social.yourdomain.com`

Avoid the throwaway `cloudflared tunnel --url ...` mode: it gives a new address each run.

## 3. Configure

```bash
cp .env.example .env     # Windows: copy .env.example .env
```
Edit `.env`:
- `BASE_URL`, `TIMEZONE`, `OWNERS`, `WA_ALLOWED` (both phone numbers, digits only with country code).
- Leave `DRY_RUN=0`.
- Fill each service as you finish its setup in step 4. The app refuses to start without `WA_APP_SECRET`.

## 4. Register with each service (use your BASE_URL)

| Service | Where | Set |
|---|---|---|
| WhatsApp Cloud API | developers.facebook.com → your app → WhatsApp | Webhook callback `BASE_URL/webhook/whatsapp`, verify token = `WA_VERIFY_TOKEN`, subscribe to **messages**. Copy token, phone-number ID and app secret into `.env`. |
| Threads API | same Meta app, Threads use case | Redirect URI `BASE_URL/oauth/threads/callback`. Add you and your wife as Threads testers and accept the invite. |
| TikTok | developers.tiktok.com | Login Kit + Content Posting API. Redirect URI `BASE_URL/oauth/tiktok/callback`. Add both of you as target users. |

## 5. Start it

Two terminals (or two background tasks):
```bash
npm start                                  # terminal 1
ngrok http --url=<your-domain> 3000        # terminal 2 (or the cloudflared command)
```
Check `https://<your-address>/health` in a browser. It should show `ok`.

Then WhatsApp the bot: `connect threads hazmi`, `connect tiktok hazmi`, and the same for `wife`. Tap each link and log in once.

## 6. Keep it running

- **Stop the PC sleeping:** Windows → Settings → Power → set Sleep to *Never* while plugged in. Mac: `caffeinate -s` or Battery settings. Linux: disable suspend.
- **Auto-start:** install pm2: `npm i -g pm2`, then `pm2 start src/index.js --name socialhq`, `pm2 save`, and set up startup with `pm2 startup` (Mac/Linux) or `pm2-installer` / Task Scheduler on Windows. Do the same for the tunnel command.
- **Back up** `data/db.json` (it holds your login tokens). Never commit or share it or `.env`.

## Troubleshooting

- WhatsApp webhook "verify failed": the tunnel isn't running, or `WA_VERIFY_TOKEN` doesn't match what you typed in Meta.
- Bot silent: your number isn't in `WA_ALLOWED` (digits only, with country code), or `WA_APP_SECRET` is wrong (look for "bad signature" in the logs).
- Connect link says "expired": links last 15 minutes. Send `connect ...` again.
- Address changed after a restart: you used a throwaway tunnel. Use option A or B.
