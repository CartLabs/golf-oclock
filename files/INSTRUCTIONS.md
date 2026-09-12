# Working instructions

Standing rules for anyone — human or AI — working on this repo. Read this before touching anything.

---

## 1. Always pull the live file before analysing, suggesting, or changing

**Never work from memory, from a summary, from build notes, or from a copy pasted earlier in a conversation.** Those go stale the moment a commit lands, and a change built on a stale copy silently overwrites whatever came after it.

Before proposing a change, before critiquing existing behaviour, and before writing a single line: fetch the current version of every file the change touches, and read it.

This applies even when you are confident. Especially then — confidence about a file you have not read is exactly how a working fix gets reverted.

### How to fetch

```bash
curl -s -o web/index.html \
  https://raw.githubusercontent.com/CartLabs/golf-oclock/main/web/index.html
```

**The raw CDN lags.** `raw.githubusercontent.com` serves a cached copy that can be several minutes behind `main`, and a cache-busting query string does not reliably defeat it. If you have just committed something, or you need certainty about current state, use the API instead:

```bash
# latest commit sha on main
curl -s https://api.github.com/repos/CartLabs/golf-oclock/commits/main

# file contents at that exact sha
curl -s -H "accept: application/vnd.github.raw" \
  "https://api.github.com/repos/CartLabs/golf-oclock/contents/web/index.html?ref=<sha>"
```

The unauthenticated API rate limit is low and shared. If it returns 403, fall back to raw and say out loud that the copy might lag.

### Read before you write

Fetching is not the same as reading. Locate the actual function or rule you are about to change and confirm it does what you think it does. A surprising amount of the time the cutoff is already correct and the real defect is somewhere adjacent — worth knowing before writing a fix for a bug that isn't there.

### Also true for the config files

`config/courses.json` and `config/watches.json` are written by the poller on a schedule. Any local copy of either is stale within fifteen minutes. Re-fetch before editing.

---

## 2. Bump the version everywhere, every time

The version lives in **four places** and they drift the moment one is forgotten. Update all four in the same commit.

| File | What to change | Notes |
|---|---|---|
| `web/version.json` | `version`, `releaseDate`, `releaseName`, `notes[]` | Semantic version. The canonical record. |
| `web/sw.js` — line 2 comment | `// v1.4.0 (Release name)` | Must match `version.json` exactly, name included. |
| `web/sw.js` — `CACHE_NAME` | `golfoclock-vN` → `golfoclock-vN+1` | **A separate counter.** It does not track the semantic version and never will. Its only job is to be different from last time, so installed phones drop their cache. |
| `package.json` | `version` | Same semantic version as `version.json`. |

`web/manifest.json` carries no version. Leave it alone.

### The CACHE_NAME trap

`CACHE_NAME` and the semantic version are two different numbers that happen to both look like versions. v1.4.0 ships on `golfoclock-v7`. Do not try to reconcile them — just make sure `CACHE_NAME` always increments.

**Forgetting `CACHE_NAME` is the worst failure mode here**, because everything looks fine: the commit lands, Pages deploys, the site serves new HTML. But every installed phone keeps serving the cached old build and shows no sign anything changed. You will be debugging code that isn't running.

### Release notes

Write `notes[]` for the person using the app six months from now, not for the commit log. What changed from their point of view, and why it matters. Not which function moved.

### Known gap

Nothing in `web/index.html` currently reads `version.json`, so the running version is not visible anywhere in the app. Until that changes, the only way to confirm an update actually landed on a phone is behavioural — look for the change itself. Worth fixing at some point; noted here so nobody assumes the version is on screen somewhere.

---

## 3. Ship checklist

- [ ] Pulled every affected file fresh, and read it
- [ ] Change made
- [ ] `web/version.json` — version, date, name, notes
- [ ] `web/sw.js` — line 2 comment matches `version.json`
- [ ] `web/sw.js` — `CACHE_NAME` incremented
- [ ] `package.json` — version matches
- [ ] `npm test` passes
- [ ] Committed, and the two `index` files went to the right folders (`web/index.html` and `src/index.js` are different files with the same name)
- [ ] Opened on the phone and confirmed the change is actually there
