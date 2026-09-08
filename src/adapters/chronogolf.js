// Chronogolf (Lightspeed) — public marketplace JSON.
// Verified live against Whip Poor Will and Souhegan Woods.
//
// Two things this API does that bite you:
//   1. It PAGINATES at 24 results. Reading only page 1 silently drops
//      late-afternoon tee times. Always page until empty.
//   2. It RATE LIMITS (429) if you hammer it. Requests are throttled and
//      backed off rather than fired in a tight loop.
// Omitting the `holes` param returns every hole count in one response,
// which halves the number of calls.
import { getJson, utcToLocalParts, normalizeTime, to12h, sleep } from '../lib.js';

const BASE = 'https://www.chronogolf.com/marketplace/v2';
const PAGE_SIZE = 24;
const MAX_PAGES = 12;              // ~288 slots/day/course; far beyond real volume
const THROTTLE_MS = Number(process.env.CHRONOGOLF_THROTTLE_MS || 900);

/** Resolve course UUIDs from the club slug, if they aren't pinned in the registry. */
async function resolveCourses(slug) {
  const club = await getJson(`${BASE}/clubs/${encodeURIComponent(slug)}`);
  return (club.courses || []).map((c) => ({ uuid: c.uuid }));
}

/** Page through one course/date until the API runs out of results. */
async function fetchDay(courseUuid, date) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${BASE}/teetimes?start_date=${date}&course_ids=${courseUuid}&page=${page}`;
    const payload = await getJson(url);
    const batch = payload.teetimes || [];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;   // short page = last page
    await sleep(THROTTLE_MS);
  }
  return rows;
}

export async function fetchChronogolf(course, dates) {
  const cfg = course.chronogolf;
  let targets = (cfg.courseUuids || []).map((uuid) => ({ uuid }));
  if (!targets.length) targets = await resolveCourses(cfg.slug);
  if (!targets.length) throw new Error(`no courses for club "${cfg.slug}"`);

  const slots = [];
  let first = true;

  for (const date of dates) {
    for (const t of targets) {
      if (!first) await sleep(THROTTLE_MS);
      first = false;

      const rows = await fetchDay(t.uuid, date);

      for (const r of rows) {
        if (r.frozen) continue;
        const max = r.max_player_size ?? 0;
        if (max <= 0) continue;

        // Prefer the UTC instant; fall back to the local wall-clock string.
        let date_, time24, label;
        if (r.starts_at) {
          ({ date: date_, time24, label } = utcToLocalParts(r.starts_at));
        } else {
          date_ = r.date;
          time24 = normalizeTime(r.start_time);
          label = time24 ? to12h(time24) : null;
        }
        if (!time24) continue;

        const price = r.default_price || {};
        slots.push({
          courseId: course.id,
          courseName: course.name,
          town: course.town,
          state: course.state,
          platform: 'Chronogolf',
          date: date_,
          time24,
          timeLabel: label,
          // Without the holes filter the response mixes 9 and 18; the price
          // block tells us which this row actually is.
          holes: price.bookable_holes ?? r.course?.holes ?? null,
          availableSpots: max,
          maxPlayers: max,
          minPlayers: r.min_player_size ?? null,
          greenFee: typeof price.green_fee === 'number' ? price.green_fee : null,
          cartFee: typeof price.half_cart === 'number' ? price.half_cart : null,
          backNine: r.hole === 10,
          bookingUrl: `${course.bookingUrl}?date=${date}`,
        });
      }
    }
  }
  return slots;
}
