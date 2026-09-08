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
import { findNewMatches, currentKeys } from './alerts.js';
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
// 8 covers every course without hammering for dates that can't exist yet.
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD || 8);

// Be a good neighbour: these are small clubs, not hyperscalers.
const DELAY_BETWEEN_COURSES_MS = Number(process.env.COURSE_DELAY_MS || 700);

const readJson = async (f, fallback) => {
  try { return JSON.parse(await readFile(p(f), 'utf8')); }
  catch { return fallback; }
};

async function main() {
  const noAlerts = process.argv.includes('--no-alerts');
  const only = getFlag('--only');

  const { courses } = await readJson('config/courses.json', { courses: [] });
  const { watches } = await readJson('config/watches.json', { watches: [] });
  const prev = await readJson('data/seen.json', { keys: [] });

  let active = courses.filter((c) => c.enabled !== false);
  if (only) active = active.filter((c) => c.id === only);

  const dates = dateWindow(DAYS_AHEAD);
  console.log(`Polling ${active.length} courses × ${DAYS_AHEAD} days (from ${dates[0]})`);

  const results = [];
  for (const course of active) {
    const adapter = ADAPTERS[course.platform];
    if (!adapter) {
      results.push({ label: course.id, ok: false, error: `no adapter for "${course.platform}"` });
      continue;
    }
    const r = await settle(course.id, () => adapter(course, dates));
    results.push(r);
    console.log(
      r.ok ? `  ok   ${course.id.padEnd(18)} ${r.value.length} slots`
           : `  FAIL ${course.id.padEnd(18)} ${r.error}`
    );
    await sleep(DELAY_BETWEEN_COURSES_MS);
  }

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

  await writeFile(p('data/teetimes.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    timezone: 'America/New_York',
    daysAhead: DAYS_AHEAD,
    courseCount: active.length,
    slotCount: slots.length,
    failures,
    courses: active.map((c) => ({
      id: c.id, name: c.name, town: c.town, state: c.state,
      platform: c.platform, bookingUrl: c.bookingUrl,
    })),
    slots,
  }, null, 0));

  // Only remember keys for dates still in range, so the file can't grow forever.
  const today = todayLocal();
  await writeFile(p('data/seen.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    keys: currentKeys(slots.filter((s) => s.date >= today)),
  }, null, 0));

  console.log(`\nWrote ${slots.length} slots across ${active.length} courses.`);
  if (failures.length) {
    console.log(`${failures.length} course(s) failed — see data/teetimes.json "failures".`);
  }
  // Never fail the workflow just because one club's server was down.
}

function getFlag(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
