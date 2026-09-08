// Shared helpers. No dependencies — Node 20+ has fetch built in.

export const TZ = 'America/New_York';

/** Headers that make us look like an ordinary browser rather than a bare script. */
const BROWSER_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="148", "Not(A:Brand";v="24", "Google Chrome";v="148"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

/** Statuses worth waiting out rather than giving up on. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Fetch JSON with a timeout and browser-ish headers.
 *
 * Retries on rate limits and transient 5xx with exponential backoff, honouring
 * Retry-After when the server sends it. On a hard failure the error carries a
 * snippet of the response body — that's what tells us whether a 403 is
 * Cloudflare blocking the runner's IP or something we can actually fix.
 */
export async function getJson(url, { headers = {}, timeoutMs = 20000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { ...BROWSER_HEADERS, ...headers },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const hint = body.replace(/\s+/g, ' ').trim().slice(0, 160);
        const err = new Error(`HTTP ${res.status} for ${url}${hint ? ` :: ${hint}` : ''}`);
        err.status = res.status;

        if (RETRYABLE.has(res.status) && attempt < retries) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 15000)
            : 1500 * Math.pow(2, attempt);   // 1.5s, 3s, 6s
          await sleep(wait);
          lastErr = err;
          continue;
        }
        throw err;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      // Network-level failures (not HTTP statuses) get a plain backoff.
      if (err.status == null && attempt < retries) await sleep(1200 * (attempt + 1));
      else if (err.status != null && !RETRYABLE.has(err.status)) throw err;
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
