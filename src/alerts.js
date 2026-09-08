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
