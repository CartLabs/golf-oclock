// TeeWire — small PHP backend, clean JSON, one tenant per course.
// Verified live against Tree House (tenant "treehouse", calendar 1).
import { getJson, normalizeTime, to12h } from '../lib.js';

export async function fetchTeewire(course, dates) {
  const { tenant, calendarId } = course.teewire;
  const slots = [];

  // TeeWire sits behind Cloudflare. From a residential browser this endpoint is
  // wide open; from a datacenter IP it can answer 403. Sending the same headers
  // a real page-load would send (notably Referer and an XHR marker) is the cheap
  // fix worth trying before falling back to a headless browser.
  const pageUrl =
    `https://teewire.app/${tenant}/index.php?controller=FrontV2&action=load&cid=${calendarId}`;

  for (const date of dates) {
    const url =
      `https://teewire.app/${tenant}/online/application/web/api/golf-api.php` +
      `?action=tee-times&calendar_id=${calendarId}&date=${date}&starting_tee=1`;

    const payload = await getJson(url, {
      headers: {
        'referer': pageUrl,
        'x-requested-with': 'XMLHttpRequest',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      },
    });
    if (!payload?.success) continue;

    for (const t of payload.data?.tee_times || []) {
      const open = t.availability?.available_spots ?? 0;
      if (open <= 0) continue;

      const time24 = normalizeTime(t.time);
      if (!time24) continue;

      // Rates carry the hole count. Group so 9 and 18 become separate rows,
      // keeping the cheapest rate for each (walking beats cart).
      const byHoles = new Map();
      for (const r of t.pricing?.rates || []) {
        const holes = r.holes ?? null;
        const price = parseMoney(r.price);
        const prev = byHoles.get(holes);
        if (!prev || (price != null && (prev.greenFee == null || price < prev.greenFee))) {
          byHoles.set(holes, { holes, greenFee: price });
        }
      }
      if (!byHoles.size) byHoles.set(null, { holes: null, greenFee: null });

      for (const v of byHoles.values()) {
        slots.push({
          courseId: course.id,
          courseName: course.name,
          town: course.town,
          state: course.state,
          platform: 'TeeWire',
          date: t.date || date,
          time24,
          timeLabel: t.time_us_format || to12h(time24),
          holes: v.holes,
          availableSpots: open,
          maxPlayers: t.availability?.max_spots ?? null,
          greenFee: v.greenFee,
          cartFee: null,
          backNine: false,
          bookingUrl: course.bookingUrl,
        });
      }
    }
  }
  return slots;
}

/** '$32.00' -> 32 */
function parseMoney(s) {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}
