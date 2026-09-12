#!/usr/bin/env node
// Golf O'Clock — poll every course, write one JSON file, push alerts on new openings.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchForeup } from './adapters/foreup.js';
import { fetchTeeitup } from './adapters/teeitup.js';
import { fetchChronogolf } from './adapters/chronogolf.js';
import { fetchTeewire } from './adapters/teewire.js';
import { dateWindow, settle, sleep, todayLocal } from './lib.js';
import { findNewMatches, currentKeys, mergeSeen, hotTargets } from './alerts.js';
import { sendPush } from './notify.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => resolve(ROOT, ...s);

const ADAPTERS = {
  foreup: fetchForeup,
  teeitup: fetchTeeitup,
  chronogolf: fetchChronogolf,
  teewire: fetchTeewire,
};

// How many days ahead to poll. Booking windows here run 4–14 days;
// 9 covers every course without hammering for dates that can't exist yet.
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD || 9);

// Be a good neighbour: these are small clubs, not hyperscalers.
const DELAY_BETWEEN_COURSES_MS = Number(process.env.COURSE_DELAY_MS || 700);

const readJson = async (f, fallback) => {
  try { return JSON.parse(await readFile(p(f), 'utf8')); }
  catch { return fallback; }
};

async function main() {
  const noAlerts = process.argv.includes('--no-alerts');
  // --hot: poll ONLY the courses and dates you have live alerts on. A handful
  // of requests instead of 15 courses x 9 days, so it can run every few minutes
  // and cut the time between a slot opening and your phone buzzing.
  const hot = process.argv.includes('--hot');
  const only = getFlag('--only');

  const { courses } = await readJson('config/courses.json', { courses: [] });
  const watchFile = await readJson('config/watches.json', { watches: [] });
  const watches = watchFile.watches || [];

  // A dated alert stays live through the whole of its date — a same-day alert
  // never switches itself off from under you. Only once every date on it is
  // strictly earlier than today does it get muted, and it is muted rather than
  // deleted so you can re-date it. Recurring rules (daysOfWeek) never expire.
  const expired = muteExpiredWatches(watches);
  if (expired.length) {
    console.log(`Muted ${expired.length} past-dated alert(s): ${expired.join('; ')}`);
    // Only the full poll writes config back — the fast poll runs every few
    // minutes and shouldn't be racing the app for this file.
    if (!hot) {
      await writeFile(p('config/watches.json'), JSON.stringify(watchFile, null, 2) + '\n');
    }
  }
  const prev = await readJson('data/seen.json', { keys: [] });

  let active = courses.filter((c) => c.enabled !== false);
  if (only) active = active.filter((c) => c.id === only);

  let dates = dateWindow(DAYS_AHEAD);

  if (hot) {
    const target = hotTargets(watches, active.map((c) => c.id), dates);
    active = active.filter((c) => target.courseIds.includes(c.id));
    dates = target.dates;
    if (!active.length || !dates.length) {
      console.log('Fast poll: no live alerts to watch. Nothing to do.');
      return;
    }
    console.log(`Fast poll: ${active.length} course(s) × ${dates.length} date(s) — ${dates.join(', ')}`);
  } else {
    console.log(`Polling ${active.length} courses × ${DAYS_AHEAD} days (from ${dates[0]})`);
  }

  // Platforms run in PARALLEL; courses within a platform stay sequential.
  //
  // Each platform is a different host with its own rate limit, so there is no
  // reason to make foreUP wait for Chronogolf. Chronogolf is the long pole —
  // it self-throttles hard to stay under a shared budget — and running it
  // alongside the others turns a run from "sum of all platforms" into "the
  // slowest platform", without touching the throttling that keeps it clean.
  const groups = new Map();
  for (const c of active) {
    if (!groups.has(c.platform)) groups.set(c.platform, []);
    groups.get(c.platform).push(c);
  }

  const timings = {};
  const started = Date.now();

  const groupResults = await Promise.all(
    [...groups.entries()].map(async ([platform, list]) => {
      const t0 = Date.now();
      const out = [];
      const log = [];
      const adapter = ADAPTERS[platform];

      for (const course of list) {
        if (!adapter) {
          out.push({ label: course.id, ok: false, error: `no adapter for "${platform}"` });
          continue;
        }
        const r = await settle(course.id, () => adapter(course, dates));
        out.push(r);
        log.push(r.ok ? `  ok   ${course.id.padEnd(18)} ${r.value.length} slots`
                      : `  FAIL ${course.id.padEnd(18)} ${r.error}`);
        await sleep(DELAY_BETWEEN_COURSES_MS);
      }

      timings[platform] = Math.round((Date.now() - t0) / 1000);
      // Print each platform's block together rather than interleaved.
      console.log(`\n[${platform}] ${timings[platform]}s\n` + log.join('\n'));
      return out;
    })
  );

  const results = groupResults.flat();
  timings._totalSeconds = Math.round((Date.now() - started) / 1000);

  const slots = results.filter((r) => r.ok).flatMap((r) => r.value);
  slots.sort((a, b) =>
    a.date.localeCompare(b.date) || a.time24.localeCompare(b.time24) ||
    a.courseName.localeCompare(b.courseName)
  );

  const failures = results.filter((r) => !r.ok).map((r) => ({ course: r.label, error: r.error }));

  // --- alerts -------------------------------------------------------------
  const activeWatches = watches.filter((w) => w.enabled !== false);
  const hits = noAlerts ? [] : findNewMatches(slots, activeWatches, prev.keys || []);
  if (hits.length) {
    console.log(`\n${hits.length} new slot(s) matched a watch:`);
    for (const h of hits.slice(0, 20)) {
      console.log(`  ${h.slot.courseName} ${h.slot.date} ${h.slot.timeLabel} (${h.watchLabels.join(', ')})`);
    }
    await sendPush(hits);
  } else if (!noAlerts) {
    console.log('\nNo new matches this run.');
  }

  // --- write outputs ------------------------------------------------------
  await mkdir(p('data'), { recursive: true });

  if (hot) {
    // Only the alert state is ours to update — teetimes.json belongs to the
    // full poll, and writing a partial view here would wipe 11 courses out of
    // the app.
    const today0 = todayLocal();
    await writeFile(p('data/seen.json'), JSON.stringify({
      updatedAt: new Date().toISOString(),
      keys: mergeSeen(
        prev.keys || [],
        active.map((c) => c.id),
        currentKeys(slots.filter((s) => s.date >= today0))
      ),
    }, null, 0));
    console.log(`\nFast poll done in ${timings._totalSeconds}s — ${slots.length} slots checked, ${hits.length} alert(s).`);
    return;
  }

  await writeFile(p('data/teetimes.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    timezone: 'America/New_York',
    daysAhead: DAYS_AHEAD,
    courseCount: active.length,
    slotCount: slots.length,
    // Per-platform wall time, so run-length regressions are visible in the data
    // rather than needing the Actions log.
    timings,
    failures,
    courses: active.map((c) => ({
      id: c.id, name: c.name, town: c.town, state: c.state,
      platform: c.platform, bookingUrl: c.bookingUrl,
      // Home courses are pinned to the top of the app's list.
      home: c.home === true,
    })),
    slots,
  }, null, 0));

  // Only remember keys for dates still in range, so the file can't grow forever.
  const today = todayLocal();
  await writeFile(p('data/seen.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    keys: currentKeys(slots.filter((s) => s.date >= today)),
  }, null, 0));

  console.log(`\nWrote ${slots.length} slots across ${active.length} courses in ${timings._totalSeconds}s.`);
  console.log('Per-platform: ' + Object.keys(timings).filter(k => k[0] !== '_')
    .map(k => k + ' ' + timings[k] + 's').join(', '));
  if (failures.length) {
    console.log(`${failures.length} course(s) failed — see data/teetimes.json "failures".`);
  }
  // Never fail the workflow just because one club's server was down.
}

/**
 * Mute one-off alerts whose dates have all passed. Mutates in place and returns
 * the labels of anything it turned off.
 *
 * "Passed" means strictly before today in the golf timezone, so an alert for
 * today survives all day — including at 11pm, when a late cancellation is
 * exactly the thing you'd want to hear about.
 */
function muteExpiredWatches(watches) {
  const today = todayLocal();
  const muted = [];
  for (const w of watches) {
    if (w.enabled === false) continue;          // already off
    if (!w.dates || !w.dates.length) continue;  // recurring — no expiry
    if (w.dates.some((d) => d >= today)) continue;
    w.enabled = false;
    muted.push(w.label || w.dates.join(', '));
  }
  return muted;
}

function getFlag(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
