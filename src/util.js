export async function httpJson(url, { method = 'GET', headers = {}, body, form, timeout = 20000 } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeout) };
  if (form) init.body = new URLSearchParams(form);
  else if (body) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    // only the path is logged: query strings can carry access tokens
    const err = new Error(`${method} ${new URL(url).pathname} -> ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const DAY = 86400000;
export { DAY };

function tzOffsetMs(ts, tz) {
  const p = localPartsRaw(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}

function localPartsRaw(ts, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: p.weekday,
  };
}

/** Wall-clock time in `tz` -> UTC epoch ms. */
export function localToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - tzOffsetMs(guess, tz);
  ts = guess - tzOffsetMs(ts, tz);
  return ts;
}

export function localParts(ts, tz) {
  const p = localPartsRaw(ts, tz);
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, hour: p.hour, weekday: p.weekday };
}

export function fmtLocal(ts, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(ts)).replace(',', '');
}

/** Accepts YYYY-MM-DD, today, tomorrow. Returns YYYY-MM-DD or null. */
export function resolveDate(word, tz, now = Date.now()) {
  const w = (word || '').toLowerCase();
  if (w === 'today') return localParts(now, tz).date;
  if (w === 'tomorrow') return localParts(now + DAY, tz).date;
  return /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : null;
}

export const fmtNum = (n) => {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return n.toLocaleString('en-US');
};

export const clip = (s, n = 60) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
