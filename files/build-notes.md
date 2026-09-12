# Golf O'Clock — Build Notes (v1)

Personal-use app. Not a product: no competitive constraints, no monetization, scope is Kevin's own play.

## Decisions made

| Decision | Choice | Why |
|---|---|---|
| Runtime | GitHub Actions cron, every 15 min | A static PWA on Drive can't poll or wake a phone. Alerting requires something running when he isn't looking. Free and always on. |
| Alerts | ntfy.sh push | Free, no account, installs as a phone app, fires from a cron job in seconds. |
| Scope | 16 public courses, 4 adapters | The easy tier. Club Prophet (3 courses) deferred behind its bot wall. |
| Credentials | GitHub Actions encrypted secrets | Kevin pastes them into GitHub's UI. Never in the repo, never in logs, never seen by Claude. |
| Hosting | GitHub Pages from the same repo | Repo must be **public** — Actions minutes are unlimited on public repos, capped at 2,000/mo on private (this job needs ~2,300), and free-tier Pages needs public. |
| Front-end structure | Matches DebtFree Dashboard | One mental model across both products. Also: a single self-contained file works from Pages, a local folder, or Google Drive — which his project brief asked for. |
| Front-end *look* | Its own — light-first, auto dark, system fonts | **Kevin's explicit correction: these are two separate projects.** Shared plumbing, not shared skin. Light-first is also the right functional call — this gets opened outdoors in daylight, unlike DebtFree which is used at a desk. |

## DebtFree Dashboard conventions (read from `~/Documents/DebtFree Dashboard/Updated files`)

Golf O'Clock mirrors the **structure** below. It deliberately does **not** copy the palette, type stack or aesthetic — see the divergences.

- **One self-contained HTML file.** DebtFree's `dashboard.html` is ~203KB with all CSS and JS inline. No build step, no npm, no framework. Siblings: `manifest.json`, `sw.js`, `version.json`, `icon-192/512.png`.
- **Design tokens:** `--bg`, `--surface/2/3`, `--border/2`, `--text/-muted/-dim`, `--accent` + `--accent2..5`, `--glow`, `--radius 16px` / `--radius-sm 8px`, `--shadow`; fonts `--font-display` Syne / `--font-body` DM Sans / `--font-mono` DM Mono from Google Fonts CDN.
- Dark-only. Grain overlay via `body::before` SVG noise, sticky header with `backdrop-filter: blur(20px)`, horizontal-scroll tab nav, `env(safe-area-inset-*)` throughout, Apple PWA meta tags.
- `sw.js`: `CACHE_NAME` bumped per release (DebtFree is on `debtfree-v20`), network-first for HTML, cache-first for other assets.
- `version.json`: `version`, `releaseDate`, `releaseName`, `notes[]`.
- Kevin already uses GitHub Actions encrypted secrets for the DebtFree content pipeline's OAuth tokens — so the credential pattern here is one he already runs.

**Deliberate divergences (v1.0.0):**
- **Visual identity is entirely its own.** A first attempt cloned DebtFree's tokens, Syne/DM Sans/DM Mono stack and dark command-center look; Kevin corrected that — he wanted structural similarity only. Golf O'Clock now uses its own light-first palette (`--ink`, `--ink-2/3`, `--card`, `--sunk`, `--green #0f7a43`) with `prefers-color-scheme` dark.
- **System fonts, zero external requests.** No Google Fonts, no CDN. Renders instantly and works with no signal — the relevant failure mode at a golf course. Also stops the two apps resembling each other by accident.
- **Availability as scorecard pips** (●●●○) rather than "3p" — faster to parse at arm's length in bright light.
- **Not** copying DebtFree's versioning workflow (duplicated folders `updated files 2..21` plus zips, no git for the app itself). Golf O'Clock uses git; ship by bumping `CACHE_NAME` + `version.json` and committing.

**Standing lesson for this project:** DebtFree and Golf O'Clock are separate products. Share plumbing and conventions; do not share branding, palette or type.

## The APIs (the valuable part)

All four platforms serve JSON. **No HTML scraping anywhere.** All verified live in a browser.

**foreUP** — unauthenticated, empty api_key:
```
https://foreupsoftware.com/index.php/api/booking/times
  ?time=all&date=MM-DD-YYYY&holes=all&players=0
  &booking_class=<id>&schedule_id=<id>&schedule_ids[]=<id>
  &specials_only=0&api_key=
```
Returns per slot: `available_spots_9/_18`, `green_fee_9/_18`, `cart_fee_9/_18`, `teesheet_side_name` (Front/Back), `maximum_players_per_booking`. Date is local wall time.

**TeeItUp / TeeOff / EZLinks** — one backend for all of them (`kenna.io`). The alias is the booking subdomain label, sent as a header:
```
GET https://phx-api-be-east-1b.kenna.io/v2/tee-times?date=YYYY-MM-DD&facilityIds=<id>&returnPromotedRates=true
    header: x-be-alias: <subdomain label>
GET https://phx-api-be-east-1b.kenna.io/alias/<alias>/facilities   # resolves ids, names, lat/long, phone
```
Returns UTC `teetime`, `bookedPlayers`, `maxPlayers`, `rates[]` with `holes` and `greenFeeWalking`/`greenFeeCart` **in cents**. `.teeitup.com` and `.teeitup.golf` share this backend — the earlier worry that they might be two platforms was unfounded.

**Chronogolf (Lightspeed)** — public marketplace JSON:
```
GET https://www.chronogolf.com/marketplace/v2/teetimes?start_date=YYYY-MM-DD&course_ids=<uuid>&holes=9|18&page=1
GET https://www.chronogolf.com/marketplace/v2/clubs/<slug>       # slug -> course uuids
```
Returns UTC `starts_at`, `min/max_player_size`, `default_price.green_fee`. Filters by hole count, so query each bookable option.

**TeeWire**:
```
GET https://teewire.app/<tenant>/online/application/web/api/golf-api.php?action=tee-times&calendar_id=1&date=YYYY-MM-DD&starting_tee=1
```
Returns `data.tee_times[]` with `availability.available_spots` and `pricing.rates[]` (each with `holes` and a `"$32.00"` string).

## Course IDs captured

foreUP (courseId/scheduleId/bookingClass): Hickory Hill 19557/1829/1443 · Passaconaway 20363/4577 · Hidden Creek 20454/4585 · Hoodkroft 18836/3372/5165 · Nabnasset 21549 (private)

Chronogolf course UUIDs: Billerica `bcad5a1d-e640-449c-9891-a0db426e3204` · Whip Poor Will `28fc945e-1336-4998-928a-949f9136dd43` · Overlook `c8913361-ea13-4fa3-8af8-a82c552fdc17` · Souhegan Woods `8b7879a8-f03e-44d2-87f7-991ffadd6607`

TeeItUp: Campbell's alias `6391c422-2e57-4bc3-a1b3-8a6676c82588` facility 15773 · Crystal Lake alias `crystal-lake-golf` facility 13676 · others resolve from alias at runtime.

## Corrections to the census

- **TeeWire does NOT require login to view.** "An account is required to book online" gates booking only. Times, prices and hole counts all render logged out. The census said Yes; it's No.
- **TeeItUp `.com` and `.golf` are one platform**, confirmed by shared API host.

## Verified

- 19 offline logic tests pass (timezone conversion incl. date rollback, watch matching, de-duplication, reopen detection).
- Poller runs end to end and degrades gracefully — one course failing never kills the run; failures land in `teetimes.json`.
- PWA rendered in headless Chromium at phone width, no JS errors; filters verified to actually filter, foursome styling verified to apply only to 4-spot slots, failure banner verified to render.
- Bug found and fixed during that check: the filter panel's `display:grid` was overriding the `hidden` attribute, so it rendered open on load. (Carried the `.panel[hidden]` guard into the rebuild.)
- Verified the app still reads correctly with Google Fonts blocked — fallback stack holds up, so it degrades gracefully offline.

## Live — SHIPPED AND STABLE

**Repo: `CartLabs/golf-oclock` (public).** App: `cartlabs.github.io/golf-oclock`, installed on Kevin's home screen. ntfy push confirmed end to end.

Moved out of the `DebtFreeDashboard` account on 2026-09-08 — that account was product-named, so every non-DebtFree project looked misfiled. `CartLabs` is the neutral master account going forward. The DebtFree repos were deliberately left behind for now (see the GitHub checklist doc).

**Final state: 15 / 15 courses, 0 failures, ~3,991 slots per run. Run time ~5m30s.**

**Pine Valley Golf Course (Pelham NH) added 2026-09-08** — Kevin's home course, missing from the original 24-course census because that list came from his handoff doc. Runs on **foreUP**: course `22278`, schedule `10318`, booking class `14033`. Its 9-hole sheet sells as either 9 or 18 (`holes: "9/18"`), so every slot yields two rows with separate fees ($37 / $50) — hence ~701 rows from ~350 actual times.

⚠️ **A Chronogolf listing exists for it** (`/club/pine-valley-golf-links`, club 9809, course uuid `4ed1f443-d983-4267-b090-1f05dc9d531b`) and returns **zero tee times on every date**. It is a stale marketplace entry, not their engine. This is now the third instance of the pattern (Hidden Creek, Overlook's dead TeeSnap, Pine Valley): **a marketplace listing is never evidence of the live booking engine — only the course's own "Book" button is.**

**Home course pinning:** set `"home": true` on any course in `config/courses.json`. The poller passes it through to `teetimes.json` and the app sorts those courses first (overriding the earliest-time sort) with a HOME tag and accent border. Not hardcoded to Pine Valley.

**Debugging note:** `raw.githubusercontent.com` serves a CDN-cached copy that can lag several minutes even with a cache-busting query string. To check fresh state, use the API instead: `api.github.com/repos/CartLabs/golf-oclock/commits` and `/contents/<path>?ref=<sha>` with `accept: application/vnd.github.raw`.

| Run | Courses with data | Slots | Notes |
|---|---|---|---|
| #2 (first real) | 11 / 16 | 2,431 | TeeItUp passed Cloudflare — the main risk did not materialise. |
| #3 (after fixes) | 12 / 16 | 2,736 | Souhegan recovered; Billerica 304 → 377 from the pagination fix. |
| #4 (throttle 2s) | 12 / 14 | 2,680 | TeeWire disabled. Failures *rotated* between Chronogolf courses — proof of a shared budget. |
| #5 (throttle 3.5s, gap 8s) | 13 / 14 | 2,912 | Only Whip Poor Will left, refused on its first request. |
| **#6 (gap 20s)** | **14 / 14** | **3,291** | **Clean. No failures.** |

**Final Chronogolf tuning** (all overridable as workflow env vars):
`CHRONOGOLF_THROTTLE_MS=3500` · `CHRONOGOLF_COURSE_GAP_MS=20000` · `CHRONOGOLF_RETRIES=6`

The breakthrough was the 20s gap *between courses*, not more throttling within them: Billerica and Whip Poor Will are the two heavy courses (377 and 382 slots), and a heavy course's paging burst was spending the whole budget before the next course got a single request through.

**Bug found in production, not in the log: Chronogolf paginates at 24.** The adapter read only page 1, silently dropping late-afternoon and twilight tee times at every Chronogolf course (Souhegan had 4 more slots, 4:36–5:03pm, on page 2). Caught by noticing 24 was a suspiciously round number and probing `page=2`. Now pages until a short page.

**Chronogolf rate limit is a whole-run budget, not per course.** Overlook was refused on its *first* request because earlier courses had spent the allowance. Fixed with a 2s throttle + jitter, up to 4 retries with exponential backoff honouring `Retry-After`, and an early stop after 2 consecutive empty days (past a course's booking window). Three regression tests lock the paging behaviour in.

**TeeWire is Cloudflare-blocked from GitHub runners.** Body confirmed as `<title>Just a moment...</title>` — the JS challenge, same wall as Club Prophet. Browser headers and a Referer did not help. **Decision: Tree House and Swanson Meadows set `enabled: false`.** The adapter is correct and verified from a residential browser; only the IP is the problem. Re-enable with one flag if their settings loosen. Options if it ever matters: Playwright step in the Action (~50/50 against datacenter IPs), or poll those two from Kevin's own machine.

**Final coverage: 14 of 16 courses** — foreUP 4, TeeItUp 6, Chronogolf 4.

## Not yet done / open threads

- **Nothing has hit a live API from a datacenter IP.** The sandbox blocks egress; the first Actions run is the real test. Most likely failure is Cloudflare on TeeItUp or Chronogolf from GitHub's IPs — if so, the fix is Playwright in the Action for those two.
- Passaconaway and Hidden Creek have no `bookingClass` captured. The API accepts the call without it; if their rates look wrong, capture it the way Hoodkroft's was.
- Booking windows: only 4 courses publish one (Billerica 4d, Campbell's 5d, Hickory Hill 6d, Windham 7d). Could be derived empirically by walking dates until slots stop.
- Club Prophet (Four Oaks, Butter Brook, Candia Woods) still behind Cloudflare — deliberate go/no-go, not attempted.
- Trull Brook (Club Caddie) needs its own adapter; the credential slot is reserved but no adapter written.
- Distance filtering is possible for free — the TeeItUp alias endpoint returns lat/long. Not built.
