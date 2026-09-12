# Tee Time Platform Census — Findings

24 of 24 courses resolved. Read-only throughout: nothing booked, no accounts, no forms, no payments.

## Platform counts, ranked

| Platform | Courses | Courses |
|---|---|---|
| **TeeItUp / TeeOff / EZLinks** (GolfNow family) | **6** | Merrimack Valley, Chelmsford, Quail Ridge, Crystal Lake, Windham, Campbell's Scottish Highlands |
| **foreUP** | **5** | Hickory Hill, Nabnasset Lake*, Passaconaway, Hidden Creek, Hoodkroft |
| **Chronogolf (Lightspeed)** | **4** | CC of Billerica, Whip Poor Will, Overlook, Souhegan Woods |
| **Club Prophet (cps.golf)** | **3** | Four Oaks, Butter Brook, Candia Woods |
| **TeeWire** | **2** | Tree House, Swanson Meadows |
| **Phone only** | **2** | Mount Pleasant, Londonderry |
| **Club Caddie** | **1** | Trull Brook |
| **Total e Integrated** | **1** | Atkinson |

\* Nabnasset is foreUP but private/members-only — no public tee sheet.

Caveat on the TeeItUp bucket: it spans **three different URL shapes** — `.teeitup.com` with a named alias, `.teeitup.com` with a facility UUID plus `?course=<id>`, and `.teeitup.golf`. They look like one platform and may well share a backend, but that is unverified. Treat it as one adapter with three tenant-addressing modes, and budget for the possibility it's two.

## The answer to the viability question

**It clusters well enough to build.** Four adapters cover 18 of 24 courses (75%); five cover 20 (83%).

The realistic target is **17 courses across 4 adapters**, because Club Prophet is a genuine obstacle (below):

| Adapter | Courses | Difficulty |
|---|---|---|
| foreUP | 5 (4 public) | **Trivial** — clean JSON |
| TeeItUp | 6 | Easy — server-rendered, dated URL |
| Chronogolf | 4 | Easy — server-rendered, dated URL |
| TeeWire | 2 | **Trivial** — clean JSON |
| Club Prophet | 3 | **Hard** — Cloudflare |

## The best finding

**foreUP serves unauthenticated JSON with an empty API key.**

```
https://foreupsoftware.com/index.php/api/booking/times
  ?time=all&date=09-08-2026&holes=all&players=0
  &booking_class=1443&schedule_id=1829&schedule_ids[]=1829
  &specials_only=0&api_key=
```

Each slot returns exactly what the app needs, already normalized: `available_spots_9` / `available_spots_18`, `green_fee_9` / `green_fee_18`, `cart_fee_9` / `cart_fee_18`, `teesheet_side_name` (Front/Back), `maximum_players_per_booking`. No parsing, no scraping, no fragility.

**TeeWire is the same story** on a different path:

```
https://teewire.app/<tenant>/online/application/web/api/golf-api.php
  ?action=tee-times&calendar_id=1&date=2026-09-08&starting_tee=1
```

Those two adapters — 7 courses, 6 of them public — are close to free. **Start there.**

## What will bite you

**1. Club Prophet is behind a Cloudflare bot challenge.** `fouroaks.cps.golf` never cleared "Just a moment…" on an automated load, and I did not attempt to get around it. This affects Four Oaks, Butter Brook and Candia Woods. Their behavior fields are unknown for the same reason. Assume these three need either a real browser session or a different approach, and price them as the expensive tier. If you drop them, you drop 3 of 24.

**2. Two courses are dead ends, and two more are non-starters.**
- Mount Pleasant — private nine-hole club, no public booking exists.
- Londonderry — genuinely phone-only, 2-day window. Confirmed negative, not a failure to find it.
- Nabnasset Lake — foreUP, but members-only behind auth.
- Trull Brook — Club Caddie, **hard login wall before any tee sheet renders**. Unusable without credentials, and it's the only Club Caddie course here, so an adapter for it serves exactly one course. Not worth writing.

**Realistic addressable universe: 20 of 24 courses.**

**3. Booking windows are short and mostly undocumented.** Only four courses publish one: CC of Billerica **4 days**, Campbell's **5 days public**, Hickory Hill **6 online / 7 phone**, Windham **7 days**. Candia Woods says 14 for members. A 4-day window means the alerting feature has a narrow window to be useful in — that's a product constraint, not just a technical one.

**4. Candia Oaks runs two courses on two separate subdomains**, not one facility with a course parameter — `candiawoods.cps.golf` and `oaksgolflinks.cps.golf`. Atkinson likewise has a main course and a separate par-3 (GolfNow 15748 and 16495). Model courses, not facilities, or you'll merge tee sheets that shouldn't merge.

**5. Overlook has two live systems.** Its old TeeSnap site (`overlookgolfclub.teesnap.net`) still resolves and shows "unavailable due to maintenance." Chronogolf is the live one. Point at the wrong one and you'll silently report zero availability forever.

**6. Something to think about competitively:** the TeeItUp engine already ships a **"Set Alert — get notified when tee times are available based on your preferences"** feature. That's your headline feature, already built, on the platform covering the most courses in your area. Your edge has to be *cross-course* alerting in one place, not alerting as such. Worth deciding deliberately before you build.

## Field-verification status

Verified directly in a browser: **foreUP** (Hickory Hill — full tee sheet, prices, 9/18, JSON API), **TeeItUp** (Campbell's and Crystal Lake — availability, prices, dated URLs), **Chronogolf** (Whip Poor Will — dated URL renders availability server-side), **TeeWire** (Tree House — full tee sheet and JSON API), **Club Caddie** (Trull Brook — login wall confirmed), **Total e Integrated** (Atkinson — search UI loads without auth).

Not verified, and why:
- **Club Prophet (3 courses)** — Cloudflare challenge, not bypassed.
- **Atkinson availability** — app returned "Invalid Device Width" in the browser pane and never painted results.
- **Per-course fields on the remaining foreUP / TeeItUp / Chronogolf courses** — inferred from the verified engine on the same platform rather than loaded individually. That inference is sound for behavior, but each foreUP course still needs one lookup to capture its own `schedule_id` and `booking_class` (Hoodkroft's in particular is missing).
- **Booking windows** — simply not published for most courses. Determinable empirically by walking dates until the API stops returning slots.

## Suggested build order

1. **foreUP + TeeWire** — 6 public courses, two JSON endpoints, near-zero parsing. Proves the pipeline end to end.
2. **Chronogolf + TeeItUp** — 10 more courses, server-rendered dated URLs. Watch for Cloudflare on TeeItUp from a datacenter IP; it passed a passive check in a real browser, which is not the same as passing from a server.
3. **Decide on Club Prophet** — 3 courses behind a bot wall. Worth a deliberate go/no-go, not a default attempt.
4. **Skip** Trull Brook, Mount Pleasant, Londonderry, Nabnasset.
