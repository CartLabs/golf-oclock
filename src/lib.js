// Shared helpers. No dependencies — Node 20+ has fetch built in.

export const TZ = 'America/New_York';

/** Fetch JSON with a timeout, a browser-ish UA, and one retry on transient failure. */
export async function getJson(url, { headers = {}, timeoutMs = 20000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
          ...headers,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1200 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 'YYYY-MM-DD' for today in the golf timezone (not the runner's UTC clock). */
export function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Add n days to a 'YYYY-MM-DD' string. */
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The next `count` dates starting today, in the golf timezone. */
export function dateWindow(count) {
  const start = todayLocal();
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/**
 * Convert a UTC instant to local {date, time24, label} in the golf timezone.
 * TeeItUp and Chronogolf both return UTC; foreUP and TeeWire return local wall time.
 */
export function utcToLocalParts(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  let hh = parts.hour === '24' ? '00' : parts.hour;
  const time24 = `${hh}:${parts.minute}`;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time24,
    label: to12h(time24),
  };
}

/** '14:05' -> '2:05pm' */
export function to12h(t24) {
  const [h, m] = t24.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

/** '7:09' or '08:00:00' -> '07:09' */
export function normalizeTime(raw) {
  const m = String(raw).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

/** Stable identity for one bookable slot — used to detect "this is newly open". */
export function slotKey(s) {
  return [s.courseId, s.date, s.time24, s.holes, s.backNine ? 'b' : 'f'].join('|');
}

/** Read a credential pair from env, e.g. credsFor('NABNASSET'). Returns null if unset. */
export function credsFor(key) {
  if (!key) return null;
  const user = process.env[`GOLF_${key}_USER`];
  const pass = process.env[`GOLF_${key}_PASS`];
  if (!user || !pass) return null;
  return { user, pass };
}

/** Never let one course's failure kill the run. */
export async function settle(label, fn) {
  try {
    return { label, ok: true, value: await fn() };
  } catch (err) {
    return { label, ok: false, error: err?.message || String(err) };
  }
}
