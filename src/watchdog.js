// Watchdog — answers one question: is the pipeline actually alive?
//
// It exists because of a silent failure on 2026-09-12: one "Fast alert poll"
// run sat in Queued for three hours, never started, and held the shared
// `golf-poll` concurrency lock. Every run behind it was cancelled. Nothing
// errored, nothing went red, no push fired. The only signal was Kevin noticing
// stale times by eye, three hours later.
//
// Two checks, in order:
//   1. Freshness  — has data/teetimes.json been written recently?
//   2. Stuck runs — is a run sitting in `queued` or `waiting` far longer than
//                   it should be? If so, cancel it, which frees the lock and
//                   lets the next run through.
//
// `waiting` was added after 2026-10-06: a full poll finished its work, then its
// Pages deploy job sat in `waiting` for over two hours. The run never ended, so
// it held the lock exactly like the queued one had — 35 runs cancelled behind
// it — and this file, which only looked for `queued`, reported stale data six
// times without being able to clear the cause.
//
// CRITICAL: this must never join the `golf-poll` concurrency group. A watchdog
// that queues behind the thing it is watching cannot report that it is stuck.

const STALE_MINUTES = Number(process.env.STALE_MINUTES || 45);
const STUCK_MINUTES = Number(process.env.STUCK_MINUTES || 20);
const NTFY_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';
const REPO = process.env.GITHUB_REPOSITORY;           // "CartLabs/golf-oclock"
const TOKEN = process.env.GITHUB_TOKEN;
const DRY_RUN = process.argv.includes('--dry-run');

const MIN = 60_000;

/** Minutes between an ISO timestamp and now. */
export function ageMinutes(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now - t) / MIN;
}

/** Freshness verdict for a teetimes.json payload. */
export function freshness(data, now = Date.now(), limit = STALE_MINUTES) {
  const age = ageMinutes(data?.updatedAt, now);
  if (age == null) return { ok: false, age: null, reason: 'no readable updatedAt' };
  return { ok: age <= limit, age, reason: `data is ${Math.round(age)} min old` };
}

// Statuses in which a run holds the lock while doing no work. `in_progress` is
// deliberately absent — slow is not the same as wedged. So is `pending`: that
// is a healthy run waiting its turn behind the lock, the victim, not the jam.
export const STUCK_STATUSES = ['queued', 'waiting'];

/** Runs that have been sitting idle too long to be normal. */
export function stuckRuns(runs, now = Date.now(), limit = STUCK_MINUTES) {
  return runs
    .filter((r) => STUCK_STATUSES.includes(r.status))
    .map((r) => ({ ...r, waited: ageMinutes(r.created_at, now) }))
    .filter((r) => r.waited != null && r.waited > limit);
}

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const PRIORITIES = { min: 1, low: 2, default: 3, high: 4, max: 5 };

async function push({ title, body, priority = 'high', tags = 'warning' }) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return console.log('[watchdog] NTFY_TOPIC not set — skipping push.');
  if (DRY_RUN) return console.log(`[watchdog] DRY RUN would push: ${title} — ${body}`);
  // JSON, not headers — see the note in notify.js. Header values are Latin-1;
  // these titles are not.
  try {
    const res = await fetch(NTFY_SERVER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        title,
        message: body,
        tags: [tags],
        priority: PRIORITIES[priority] ?? 3,
        click: `https://github.com/${REPO}/actions`,
      }),
    });
    // Log the outcome either way. "No error" is not the same as "delivered",
    // and telling those apart from the log is the whole point of this file.
    if (!res.ok) console.error(`[watchdog] push rejected: ${res.status} ${await res.text()}`);
    else console.log(`[watchdog] push accepted by ${NTFY_SERVER} (HTTP ${res.status}). If your phone stayed quiet, the break is between ntfy and the handset, not in this repo.`);
  } catch (err) {
    console.error('[watchdog] push failed:', err.message);
  }
}

async function main() {
  // A healthy pipeline is silent, so the push path is never exercised in normal
  // operation — an alarm nobody has heard ring is not yet an alarm. TEST_PUSH
  // sends one deliberately, from a manual run, and changes nothing else.
  if (process.env.TEST_PUSH === 'true') {
    console.log('[watchdog] sending test push.');
    await push({
      title: '⛳ Watchdog test',
      body: 'If this reached your phone, stale-data and stuck-run alerts will too.',
      priority: 'max',
      tags: 'white_check_mark',
    });
  }

  const problems = [];

  // ---- 1. Is the data fresh? -------------------------------------------
  const raw = await import('node:fs/promises')
    .then((fs) => fs.readFile('data/teetimes.json', 'utf8'))
    .catch(() => null);

  if (!raw) {
    problems.push('data/teetimes.json is missing or unreadable.');
  } else {
    const f = freshness(JSON.parse(raw));
    console.log(`[watchdog] ${f.reason} (limit ${STALE_MINUTES} min) — ${f.ok ? 'OK' : 'STALE'}`);
    if (!f.ok) problems.push(`Tee time data is ${Math.round(f.age)} minutes old.`);
  }

  // ---- 2. Is a run wedged, holding the lock? ----------------------------
  // Done even when the data looks fine: catching a jam early is the whole point.
  let cancelled = [];
  if (TOKEN && REPO) {
    try {
      // Ask for each stuck status by name rather than reading the newest page
      // of runs. A jam buries itself: the pollers fire every few minutes, so
      // within the hour the wedged run is far off the first page and a plain
      // "latest 30" listing would never see it.
      const runs = [];
      for (const status of STUCK_STATUSES) {
        const page = await gh(`/repos/${REPO}/actions/runs?status=${status}&per_page=30`);
        runs.push(...(page.workflow_runs || []));
      }
      const stuck = stuckRuns(runs).filter((r) => r.id !== Number(process.env.GITHUB_RUN_ID));

      for (const r of stuck) {
        console.log(`[watchdog] ${r.name} #${r.run_number} ${r.status} ${Math.round(r.waited)} min — cancelling.`);
        if (DRY_RUN) continue;
        try {
          await gh(`/repos/${REPO}/actions/runs/${r.id}/cancel`, { method: 'POST' });
          cancelled.push(`${r.name} #${r.run_number} (${r.status} ${Math.round(r.waited)} min)`);
        } catch (err) {
          console.error(`[watchdog] could not cancel #${r.run_number}:`, err.message);
          problems.push(`A run is stuck (${r.status}) and could not be cancelled: #${r.run_number}.`);
        }
      }
      if (!stuck.length) console.log('[watchdog] no runs stuck in queued or waiting.');
    } catch (err) {
      console.error('[watchdog] could not read workflow runs:', err.message);
    }
  }

  // ---- 3. Say something useful ------------------------------------------
  if (cancelled.length) {
    await push({
      title: '⛳ Poller was jammed — unstuck it',
      body: `Cancelled ${cancelled.join(', ')}.\nPolling should resume within 15 minutes. No action needed unless this repeats.`,
      priority: 'default',
      tags: 'wrench',
    });
  }

  if (problems.length) {
    await push({
      title: '⛳ Tee times have gone stale',
      body: `${problems.join('\n')}\nAlerts are not being checked right now.`,
    });
    console.error('[watchdog] PROBLEMS:\n' + problems.join('\n'));
    process.exit(1);          // red run + GitHub's own failure email, for free
  }

  console.log('[watchdog] healthy.');
}

if (process.argv[1]?.endsWith('watchdog.js')) {
  main().catch((err) => {
    console.error('[watchdog] crashed:', err);
    process.exit(1);
  });
}
