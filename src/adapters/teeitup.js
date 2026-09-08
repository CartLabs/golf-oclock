// TeeItUp / TeeOff / EZLinks — all GolfNow family, all one backend (kenna.io).
// The alias is just the booking subdomain label; it goes in the x-be-alias header.
// Verified live against Campbell's Scottish Highlands and Crystal Lake.
import { getJson, utcToLocalParts } from '../lib.js';

const API = 'https://phx-api-be-east-1b.kenna.io';

/** Resolve a tenant's facility IDs (and its real name/coords) from the alias alone. */
async function resolveFacilities(alias) {
  const list = await getJson(`${API}/alias/${encodeURIComponent(alias)}/facilities`, {
    headers: { 'x-be-alias': alias },
  });
  return Array.isArray(list) ? list : [];
}

export async function fetchTeeitup(course, dates) {
  const { alias } = course.teeitup;
  let facilityIds = course.teeitup.facilityIds;

  // Self-healing: if IDs aren't pinned in the registry, look them up.
  if (!facilityIds || !facilityIds.length) {
    const facilities = await resolveFacilities(alias);
    facilityIds = facilities.map((f) => f.id).filter(Boolean);
    if (!facilityIds.length) throw new Error(`no facilities for alias "${alias}"`);
  }

  const slots = [];
  for (const date of dates) {
    for (const fid of facilityIds) {
      const url = `${API}/v2/tee-times?date=${date}&facilityIds=${fid}&returnPromotedRates=true`;
      const payload = await getJson(url, { headers: { 'x-be-alias': alias } });
      const groups = Array.isArray(payload) ? payload : [];

      for (const g of groups) {
        for (const tt of g.teetimes || []) {
          const open = (tt.maxPlayers ?? 0) - (tt.bookedPlayers ?? 0);
          if (open <= 0) continue;

          const { date: localDate, time24, label } = utcToLocalParts(tt.teetime);

          // Rates carry the hole count and price. Collapse to one row per hole count,
          // keeping the cheapest green fee we can see for that option.
          const byHoles = new Map();
          for (const r of tt.rates || []) {
            const holes = r.holes ?? null;
            // Prices are in cents.
            const green = pickCents(r.greenFeeWalking, r.greenFeeCart);
            const prev = byHoles.get(holes);
            if (!prev || (green != null && (prev.greenFee == null || green < prev.greenFee))) {
              byHoles.set(holes, {
                holes,
                greenFee: green,
                cartFee: r.greenFeeCart != null ? r.greenFeeCart / 100 : null,
                allowedPlayers: r.allowedPlayers || null,
              });
            }
          }
          if (!byHoles.size) byHoles.set(null, { holes: null, greenFee: null, cartFee: null });

          for (const v of byHoles.values()) {
            slots.push({
              courseId: course.id,
              courseName: course.name,
              town: course.town,
              state: course.state,
              platform: 'TeeItUp',
              date: localDate,
              time24,
              timeLabel: label,
              holes: v.holes,
              availableSpots: open,
              maxPlayers: tt.maxPlayers ?? null,
              greenFee: v.greenFee,
              cartFee: v.cartFee,
              backNine: !!tt.backNine,
              bookingUrl: course.bookingUrl,
            });
          }
        }
      }
    }
  }
  return slots;
}

function pickCents(...vals) {
  for (const v of vals) if (typeof v === 'number' && v > 0) return v / 100;
  return null;
}
