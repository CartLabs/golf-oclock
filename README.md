# Golf O'Clock

Every open tee time across 16 public courses in the Merrimack Valley and southern NH, in one place, on your phone — plus a push notification the moment a slot you want opens up.

Built for one user. No accounts, no server, no monthly cost.

---

## How it works

```
GitHub Actions cron (every 15 min)
        │
        ├─ hits 4 booking APIs  →  normalizes everything into one shape
        │
        ├─ compares against last run  →  new opening?  →  push to your phone
        │
        └─ commits data/teetimes.json  →  GitHub Pages serves the app
                                                  │
                                          you open the PWA
```

The phone app is a static page. It never polls a golf course itself — it just reads the JSON the cron job committed. That's why it's instant, works offline, and costs nothing.

## What it covers

**16 public courses across 4 platforms**, all via clean JSON APIs — no HTML scraping:

| Platform | Courses |
|---|---|
| foreUP | Hickory Hill, Passaconaway, Hidden Creek, Hoodkroft |
| TeeItUp | Merrimack Valley, Chelmsford, Quail Ridge, Crystal Lake, Windham, Campbell's Scottish Highlands |
| Chronogolf | CC of Billerica, Whip Poor Will, Overlook, Souhegan Woods |
| TeeWire | Tree House, Swanson Meadows |

Deliberately excluded: Mount Pleasant and Londonderry (no online booking at all), Four Oaks / Butter Brook / Candia Woods (Club Prophet, behind a bot wall), Trull Brook and Nabnasset (login required — see *Course logins* below).

---

## Setup — about 10 minutes

### 1. Put it on GitHub

Create a new repository and push this folder to it.

> **Make the repo public.** Two reasons, both practical: GitHub Actions minutes are **unlimited on public repos** but capped at 2,000/month on private ones — and this job would use roughly 2,300. GitHub Pages also needs a public repo on the free plan. Nothing sensitive lives in the repo; your logins go in encrypted secrets, which stay private either way.

### 2. Turn on Pages

**Settings → Pages → Source: GitHub Actions.**

### 3. Set up push notifications

1. Install **ntfy** on your phone (App Store / Play Store — it's free).
2. Make up a long, random topic name. Treat it like a password — anyone who knows it can read your alerts. Something like `golf-kev-7fq2x9m4vz`.
3. In the app, subscribe to that topic.
4. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NTFY_TOPIC`
   - Value: your topic name

### 4. Run it once

**Actions → Poll tee times → Run workflow.** First run takes about a minute. When it finishes, your app is live at `https://<your-username>.github.io/<repo-name>/`.

Open it on your phone and **Add to Home Screen**. It installs like a real app.

---

## Setting up your alerts

Edit `config/watches.json`. A rule fires when a slot that matches it *becomes newly open* — you get told once, not every 15 minutes. If a slot gets taken and later frees up again, you get told again.

```json
{
  "label": "Saturday morning foursome",
  "enabled": true,
  "courses": ["any"],
  "daysOfWeek": [6],
  "timeFrom": "07:00",
  "timeTo": "10:00",
  "holes": 18,
  "minSpots": 4,
  "maxGreenFee": 70
}
```

| Field | Meaning |
|---|---|
| `courses` | Course ids from `config/courses.json`, or `["any"]` |
| `dates` | Exact dates `["2026-09-20"]` — use instead of `daysOfWeek` |
| `daysOfWeek` | `0`=Sunday … `6`=Saturday |
| `withinDays` | Only slots this many days out |
| `timeFrom` / `timeTo` | 24-hour local window |
| `holes` | `9`, `18`, or omit for either |
| `minSpots` | Open spots needed — `4` for a foursome |
| `maxGreenFee` | Dollars. Slots with unknown pricing won't match |
| `enabled` | `false` mutes a rule without deleting it |

Commit the change and it takes effect on the next run.

## Adding or removing a course

Edit `config/courses.json`. Set `"enabled": false` to drop one without deleting it. To add a course on a platform already supported, copy an existing entry and swap the IDs.

## Course logins

Some courses hide their tee sheet behind a login. The plumbing is built; you supply the credentials, and **they never touch this repo**.

1. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**
2. Add a pair named after the course's `credentialKey` in `courses.json`:
   - `GOLF_NABNASSET_USER` / `GOLF_NABNASSET_PASS`
3. Set that course's `"enabled": true`.

Secrets are encrypted, are never printed in logs, and aren't readable by anyone but you — not even from a workflow run's output. If you later want Trull Brook (Club Caddie), it needs a small adapter written; the credential slot is already reserved.

---

## Running it on your own machine

```bash
node src/index.js                 # poll and alert
node src/index.js --no-alerts     # poll without notifying (safe for testing)
node src/index.js --only hickory-hill
npm test                          # offline logic tests, no network
```

Needs Node 20+. No dependencies to install.

---

## Things worth knowing

**Booking windows are short.** CC of Billerica is 4 days out, Campbell's 5, Hickory Hill 6, Windham 7. The poller looks 8 days ahead, which covers everything — but a course simply won't have times beyond its own window. That's not a bug.

**GitHub disables scheduled workflows after ~60 days of repository inactivity.** Bot commits don't always count. If alerts go quiet for a long stretch, check the Actions tab — one manual "Run workflow" re-arms it.

**Scheduled runs can drift.** GitHub's cron is best-effort and gets busy on the hour; a 15-minute schedule may land at 18. Fine for tee times, worth knowing before you think something's broken.

**Be a good neighbour.** These are small clubs, not hyperscalers. The poller waits between courses and runs every 15 minutes, not every 30 seconds. If you tighten `cron`, you risk getting IP-blocked — which breaks your own app first.

**One course failing won't break the run.** Failures are recorded in `data/teetimes.json` under `failures` and shown at the bottom of the app.

**Prices are indicative.** Every platform reports rates differently — walking vs riding, member vs public, per-player vs total. The app shows the cheapest green fee it can see for that hole count. Always confirm on the booking page.

---

## Where things live

```
config/courses.json     the 17 courses and their platform IDs
config/watches.json     your alert rules
src/adapters/           one file per booking platform
src/alerts.js           watch matching + "is this newly open?"
src/notify.js           ntfy push
src/index.js            the entry point the cron runs
web/index.html          the whole phone app — one self-contained file
web/manifest.json       PWA install config
web/sw.js               service worker (bump CACHE_NAME to force a refresh)
web/version.json        version, release name, release notes
web/icon-192.png        home screen icons
data/teetimes.json      what the cron commits, what the app reads
data/seen.json          what was open last run — powers de-duplication
test/logic.test.js      offline tests
```

## Front-end conventions

The *structure* follows DebtFree Dashboard so there's one mental model to maintain. The *look* is its own.

**Shared structure:**
- **One self-contained HTML file.** All CSS and JS inline. No build step, no npm, no framework. Opens identically from a local folder, Google Drive, or GitHub Pages.
- **Same PWA setup** — `manifest.json`, `sw.js` with a `CACHE_NAME` you bump per release, `version.json` carrying version / releaseDate / releaseName / notes, Apple meta tags, safe-area insets.

**Its own design:**
- **Light-first, auto dark.** You open this outdoors in daylight, so contrast is tuned for sun rather than for a desk; it follows the phone's setting and goes dark at night on its own.
- **System fonts, no CDN.** Nothing external loads, so it paints instantly and works with no signal — which is the point at a course with one bar.
- Own palette (`--ink`, `--ink-2/3`, `--card`, `--sunk`, `--green`), own tokens. Deliberately not DebtFree's.
- Availability shows as scorecard-style pips (●●●○) rather than "3p" — faster to read at arm's length in bright light.

**To ship an update:** edit `web/index.html`, bump `CACHE_NAME` in `web/sw.js` and the version in `web/version.json`, commit. Installed phones pick it up on next open. That replaces DebtFree's copy-the-folder-and-zip-it routine — git keeps the history for you.
