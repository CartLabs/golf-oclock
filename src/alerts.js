// Watch matching + de-duplication.
// The rule: alert once when a slot becomes open. Don't nag every 10 minutes
// about the same slot, but DO alert again if it closes and later reopens.
import { slotKey } from './lib.js';

export function matchesWatch(slot, watch) {
  if (watch.enabled === false) return false;

  const courses = watch.courses || ['any'];
  if (!courses.includes('any') && !courses.includes(slot.courseId)) return false;

  if (watch.dates?.length && !watch.dates.includes(slot.date)) return false;

  if (watch.daysOfWeek?.length) {
    // Parse as noon UTC so the weekday can't slip across a timezone boundary.
    const dow = new Date(`${slot.date}T12:00:00Z`).getUTCDay();
    if (!watch.daysOfWeek.includes(dow)) return false;
  }

  if (watch.withinDays != null) {
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`);
    const d = new Date(`${slot.date}T12:00:00Z`);
    const out = Math.round((d - today) / 86400000);
    if (out > watch.withinDays) return false;
  }

  if (watch.timeFrom && slot.time24 < watch.timeFrom) return false;
  if (watch.timeTo && slot.time24 > watch.timeTo) return false;

  if (watch.holes != null && slot.holes != null && slot.holes !== watch.holes) return false;

  if (watch.minSpots != null && (slot.availableSpots ?? 0) < watch.minSpots) return false;

  if (watch.maxGreenFee != null) {
    if (slot.greenFee == null || slot.greenFee > watch.maxGreenFee) return false;
  }

  return true;
}

/**
 * Compare this poll against what we saw last time.
 * Returns the slots that are newly open AND match at least one watch.
 */
export function findNewMatches(slots, watches, seenKeys) {
  const seen = new Set(seenKeys);
  const hits = [];

  for (const slot of slots) {
    const key = slotKey(slot);
    if (seen.has(key)) continue; // already known to be open — not news

    const matched = watches.filter((w) => matchesWatch(slot, w));
    if (matched.length) {
      hits.push({ slot, watchLabels: matched.map((w) => w.label) });
    }
  }
  return hits;
}

/** The keys we should remember as "currently open" for the next run. */
export function currentKeys(slots) {
  return [...new Set(slots.map(slotKey))];
}

/**
 * Merge seen-state when only SOME courses were polled.
 *
 * The fast poll only looks at courses you have alerts on. If it simply wrote
 * its own keys, every other course would look brand new on the next full poll
 * and you'd get an alert storm. So: drop the keys for courses we just polled
 * (their current state replaces the old), and keep everyone else's untouched.
 */
export function mergeSeen(prevKeys, polledCourseIds, freshKeys) {
  const polled = new Set(polledCourseIds);
  const kept = (prevKeys || []).filter((k) => !polled.has(String(k).split('|')[0]));
  return [...new Set(kept.concat(freshKeys))];
}

/**
 * Which courses and dates actually need watching right now.
 *
 * Used by the fast poll so it hits a handful of endpoints every few minutes
 * instead of all 15 courses across 8 days.
 */
export function hotTargets(watches, allCourseIds, allDates) {
  const courseIds = new Set();
  const dates = new Set();
  const today = allDates[0];

  for (const w of watches || []) {
    if (w.enabled === false) continue;

    // A one-off watch whose dates have all passed is dead weight.
    const wDates = (w.dates || []).filter((d) => d >= today);
    if (w.dates && w.dates.length && !wDates.length) continue;

    const cs = w.courses || ['any'];
    (cs.includes('any') ? allCourseIds : cs).forEach((id) => courseIds.add(id));

    if (wDates.length) {
      wDates.forEach((d) => { if (allDates.includes(d)) dates.add(d); });
    } else if (w.daysOfWeek && w.daysOfWeek.length) {
      allDates.forEach((d) => {
        const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
        if (w.daysOfWeek.includes(dow)) dates.add(d);
      });
    } else {
      allDates.forEach((d) => dates.add(d));
    }
  }
  return { courseIds: [...courseIds], dates: [...dates].sort() };
}
