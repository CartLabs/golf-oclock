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

// Chronogolf's rate limit is a budget across the WHOLE run, not per course —
// the third and fourth courses were being refused on their first request
// because earlier courses had already spent it. Hence a generous throttle and
// a patient backoff rather than a tight loop.
// Read lazily so tests (and one-off runs) can turn the throttle down via env.
// Tuning history: 900ms → three courses lost to 429. 2000ms → still two lost,
// and WHICH two rotated between runs, confirming a shared budget rather than a
// per-course one. 3500ms keeps us near ~17 requests/min.
const throttleMs = () =>
  process.env.CHRONOGOLF_THROTTLE_MS != null
    ? Number(process.env.CHRONOGOLF_THROTTLE_MS)
    : 3500;
const retries = () => Number(process.env.CHRONOGOLF_RETRIES || 6);   // waits ~1.5s→48s

// Extra breathing room when moving to the next course, so one course's paging
// burst doesn't spend the budget the next course needs.
const COURSE_GAP_MS = Number(process.env.CHRONOGOLF_COURSE_GAP_MS || 8000);

// A course only sells so far ahead (4–14 days here). Once we hit two empty days
// in a row we're past its booking window, so stop burning requests on dates that
// cannot have times. Two in a row, not one, so a single sold-out day can't
// truncate the rest of the week.
const EMPTY_DAYS_BEFORE_STOP = 2;

const jitter = () => throttleMs() + Math.floor(Math.random() * 400);

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
    const payload = await getJson(url, { retries: retries() });
    const batch = payload.teetimes || [];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;   // short page = last page
    await sleep(jitter());
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

  // Walk course-by-course rather than date-by-date, so the empty-day counter
  // below tracks one course's booking window at a time.
  for (const t of targets) {
    let emptyRun = 0;
    if (!first) await sleep(COURSE_GAP_MS);

    for (const date of dates) {
      if (emptyRun >= EMPTY_DAYS_BEFORE_STOP) break;   // past this course's window

      if (!first) await sleep(jitter());
      first = false;

      const rows = await fetchDay(t.uuid, date);
      emptyRun = rows.length ? 0 : emptyRun + 1;

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
