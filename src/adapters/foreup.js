// foreUP — the cleanest of the four. Unauthenticated JSON, empty api_key.
// Verified live against Hickory Hill (course 19557 / schedule 1829).
import { getJson, normalizeTime, to12h, credsFor } from '../lib.js';

const BASE = 'https://foreupsoftware.com/index.php';

/** foreUP wants MM-DD-YYYY, not ISO. */
function usDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${m}-${d}-${y}`;
}

/**
 * Optional member login. Only needed for private courses (e.g. Nabnasset).
 * Public courses never call this. Returns a cookie string or null.
 *
 * Credentials come from GitHub Actions encrypted secrets via env vars —
 * they are never stored in this repo and never printed to logs.
 */
async function login(course) {
  const creds = credsFor(course.credentialKey);
  if (!creds) return null;

  const res = await fetch(`${BASE}/api/booking/users/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: new URLSearchParams({
      username: creds.user,
      password: creds.pass,
      booking_class_id: '',
      api_key: 'no_limits',
      course_id: String(course.foreup.courseId),
    }),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  const cookie = res.headers.get('set-cookie');
  return cookie ? cookie.split(';')[0] : null;
}

export async function fetchForeup(course, dates) {
  const { courseId, scheduleId, bookingClass } = course.foreup;
  if (!scheduleId) {
    throw new Error(
      `no scheduleId configured (open ${course.bookingUrl} once and capture it — see README)`
    );
  }

  let cookie = null;
  if (course.requiresAuth) {
    cookie = await login(course);
    if (!cookie) throw new Error('requiresAuth but no credentials set in env');
  }

  const slots = [];
  for (const date of dates) {
    const qs = new URLSearchParams({
      time: 'all',
      date: usDate(date),
      holes: 'all',
      players: '0',
      schedule_id: String(scheduleId),
      specials_only: '0',
      api_key: '',
    });
    qs.append('schedule_ids[]', String(scheduleId));
    if (bookingClass) qs.set('booking_class', String(bookingClass));

    const rows = await getJson(`${BASE}/api/booking/times?${qs}`, {
      headers: cookie ? { cookie } : {},
    });
    if (!Array.isArray(rows)) continue;

    for (const r of rows) {
      // foreUP returns local wall time as "YYYY-MM-DD HH:MM"
      const [d, t] = String(r.time).split(' ');
      const time24 = normalizeTime(t);
      if (!time24) continue;

      // A slot can be sold as 9 and/or 18. Emit each separately so filters work.
      const variants = [];
      if (r.available_spots_18 > 0) {
        variants.push({ holes: 18, spots: r.available_spots_18, green: r.green_fee_18, cart: r.cart_fee_18 });
      }
      if (r.available_spots_9 > 0) {
        variants.push({ holes: 9, spots: r.available_spots_9, green: r.green_fee_9, cart: r.cart_fee_9 });
      }
      // Some tee sheets only populate the generic fields.
      if (!variants.length && r.available_spots > 0) {
        variants.push({ holes: r.holes || r.teesheet_holes || null, spots: r.available_spots, green: r.green_fee, cart: r.cart_fee });
      }

      for (const v of variants) {
        slots.push({
          courseId: course.id,
          courseName: course.name,
          town: course.town,
          state: course.state,
          platform: 'foreUP',
          date: d,
          time24,
          timeLabel: to12h(time24),
          holes: v.holes,
          availableSpots: v.spots,
          maxPlayers: r.maximum_players_per_booking ?? null,
          greenFee: numOrNull(v.green),
          cartFee: numOrNull(v.cart),
          backNine: String(r.teesheet_side_name || '').toLowerCase() === 'back',
          bookingUrl: course.bookingUrl,
        });
      }
    }
  }
  return slots;
}

const numOrNull = (v) => (typeof v === 'number' && v > 0 ? v : null);
