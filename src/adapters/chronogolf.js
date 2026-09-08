// Chronogolf (Lightspeed) — public marketplace JSON.
// Verified live against Whip Poor Will (course uuid 28fc945e-...).
import { getJson, utcToLocalParts, normalizeTime, to12h } from '../lib.js';

const BASE = 'https://www.chronogolf.com/marketplace/v2';

/** Resolve course UUIDs from the club slug, if they aren't pinned in the registry. */
async function resolveCourses(slug) {
  const club = await getJson(`${BASE}/clubs/${encodeURIComponent(slug)}`);
  return (club.courses || []).map((c) => ({ uuid: c.uuid, holes: c.bookable_holes || [c.holes] }));
}

export async function fetchChronogolf(course, dates) {
  const cfg = course.chronogolf;
  let targets = (cfg.courseUuids || []).map((uuid) => ({ uuid, holes: cfg.holes || [18] }));
  if (!targets.length) targets = await resolveCourses(cfg.slug);
  if (!targets.length) throw new Error(`no courses for club "${cfg.slug}"`);

  const slots = [];
  for (const date of dates) {
    for (const t of targets) {
      // The API filters by hole count, so ask for each bookable option separately.
      for (const holes of t.holes) {
        const url =
          `${BASE}/teetimes?start_date=${date}` +
          `&course_ids=${t.uuid}&holes=${holes}&page=1`;
        const payload = await getJson(url);
        const rows = payload.teetimes || [];

        for (const r of rows) {
          if (r.frozen) continue;
          const max = r.max_player_size ?? 0;
          if (max <= 0) continue;

          // Chronogolf gives both a UTC instant and a local wall time. Prefer UTC,
          // fall back to the local string if starts_at is missing.
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
            holes: price.bookable_holes ?? holes,
            // Chronogolf exposes the party-size range rather than a booked count.
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
  }
  return slots;
}
