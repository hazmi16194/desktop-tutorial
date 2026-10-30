import fs from 'node:fs';

function loadDotEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function loadConfig(env = process.env) {
  const owners = (env.OWNERS || 'me,wife').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const waAllowed = {};
  for (const pair of (env.WA_ALLOWED || '').split(',')) {
    const [num, owner] = pair.split(':').map((s) => s.trim());
    if (num && owner) waAllowed[num.replace(/\D/g, '')] = owner.toLowerCase();
  }
  const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
  return {
    port: Number(env.PORT) || 3000,
    baseUrl: (env.BASE_URL || '').replace(/\/$/, ''),
    dataDir: env.DATA_DIR || 'data',
    tz: env.TIMEZONE || 'UTC',
    digestHour: env.DIGEST_HOUR === undefined ? 8 : Number(env.DIGEST_HOUR),
    dryRun: bool(env.DRY_RUN, false),
    owners,
    waAllowed,
    crossAccess: bool(env.CROSS_ACCESS, true),
    wa: {
      token: env.WA_TOKEN, phoneId: env.WA_PHONE_ID, verifyToken: env.WA_VERIFY_TOKEN,
      appSecret: env.WA_APP_SECRET, template: env.WA_TEMPLATE_NAME, templateLang: env.WA_TEMPLATE_LANG || 'en',
    },
    threads: { appId: env.THREADS_APP_ID, appSecret: env.THREADS_APP_SECRET },
    tiktok: { clientKey: env.TIKTOK_CLIENT_KEY, clientSecret: env.TIKTOK_CLIENT_SECRET, privacy: env.TIKTOK_PRIVACY || 'SELF_ONLY' },
    ai: { key: env.ANTHROPIC_API_KEY, model: env.AI_MODEL || 'claude-sonnet-5-5' },
    autoReplyDailyCap: Number(env.AUTO_REPLY_DAILY_CAP) || 20,
  };
}

export function loadConfigFromEnvFile() {
  loadDotEnv();
  return loadConfig();
}
