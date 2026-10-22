# Sustainability Week Zurich 2026 — Event Planner

A responsive event planner: browse the programme day by day, filter by campus, category and language, and save events to a personal My Week list stored in the browser.

Built against the NHWZ developer brief. Vanilla HTML, CSS and JavaScript — no framework, no build step.

## Quick start

Any static file server works. The simplest:

```
cd nhwz-planner
python -m http.server 8099 --bind 127.0.0.1
```

Then open **http://127.0.0.1:8099/**

`file://` will not work — the app fetches `data/events.json`, which browsers block on the file protocol. A server is required, local or hosted.

## Deployment to shared hosting

Upload these five items to `public_html` (or your domain root), preserving the folder structure:

```
index.html
styles.css
app.js
data/events.json
```

No database, no PHP, no Node on the server. No `.htaccess` rewriting is needed. `acceptance.mjs`, `package.json` and `node_modules/` are development-only and must **not** be uploaded.

Tested on Apache with PHP 8.2 available but unused. Works on any host that serves static files over HTTPS.

## Editing events

All content lives in `data/events.json`. No code changes are required to add, remove or edit events.

Each event is an object:

```json
{
  "id": "e01",
  "title": "Computer Maintenance and Repair",
  "day": "2026-04-13",
  "start": "10:00",
  "end": "12:00",
  "campus": "UZH Irchel",
  "venue": "UZH Irchel Tent",
  "address": "Winterthurerstrasse 190, 8057 Zurich",
  "category": "Workshop",
  "language": "en",
  "status": "confirmed",
  "description": "...",
  "mapUrl": "https://maps.google.com/?q=...",
  "registrationUrl": "https://...",
  "registrationRequired": true
}
```

**Field rules**

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable. Never reuse an ID for a different event — saved lists reference it |
| `day` | yes | Must match an `id` in the top-level `days` array, format `YYYY-MM-DD` |
| `start` / `end` | yes / optional | 24-hour `HH:MM`. Ordering uses `start`, then title |
| `campus` / `category` | yes | Must match a value in the top-level arrays, or the filter will never match it |
| `language` | yes | `en`, `de`, or `both` |
| `status` | yes | `confirmed` or `cancelled`. Cancelled events stay visible and saveable, registration blocked |
| `mapUrl` | optional | Must be `http` or `https`. Omit or `null` if unknown — the app says so rather than inventing one |
| `registrationUrl` | optional | Same rule. `null` means no registration |
| `registrationRequired` | yes | `true` shows organiser-contact guidance when no URL is supplied |
| `historicalRegistration` | optional | `true` hides a stale link from a previous year |

**To add a campus, category or day**, add the value to its top-level array in the same file. The filter panel reads those arrays.

**Editing safely:** open the JSON in any text editor, keep the commas between objects, and validate with `python -m json.tool data/events.json` before saving. A malformed file leaves the app showing "Could not load events".

## Running the acceptance checks

Development only — requires Node.js and Playwright.

```
npm install
npx playwright install chromium
python -m http.server 8099 --bind 127.0.0.1   # in one terminal
node acceptance.mjs http://127.0.0.1:8099/    # in another
```

Output is a pass/fail line per check and a final count. Exit code 0 means all passed. The script asserts the numbers in the brief:

- Monday: all = 5, English = 4, German = 1, both = 5
- UZH Irchel + Workshop + English returns e01/e03
- Workshop returns e01/e03/e04
- Cancelled e04 stays visible and saveable
- e07 shows no invented map
- Escape discards the filter draft
- Saves persist after reload
- No horizontal overflow at 320, 390 and 1440 px

## Architecture notes

**Language filter is a three-branch rule, not an intersection.** English alone shows English-only events. German alone shows German-only **plus** bilingual. Both selected returns the union. This is implemented in `langMatches()` and is not the same as an array intersection — treat it as a specification, not a bug.

**Filter panel has draft state.** Checkbox changes are a draft until "Show results" is pressed. Close, Escape and the backdrop all discard the draft. Focus returns to the Filters button on every exit path.

**Saved events survive three failure modes.** Malformed JSON starts empty. Unknown IDs are silently dropped against the current dataset. Unavailable storage falls back to session-only saves with a visible notice. Cross-tab sync uses the `storage` event.

**No invented data.** Events without a map URL show "Location details were not supplied" and no link. Cancelled events show a label and blocked registration. Stale registration links are hidden with an explanation.

## Dependencies and licences

**The delivered app has zero runtime dependencies.** No libraries, no CDN, no fonts, no trackers.

**Development dependencies** (not shipped):

- **Playwright** — Apache 2.0. Used only by `acceptance.mjs`.
- **Node.js** — MIT. Development environment only.

System fonts are used (`Segoe UI`, `system-ui`, fallbacks), so no font licence applies.

## Known limitations

- Demo dataset holds eight sample events, not the full 2026 programme.
- Maps are links, not embeds. An embed would load Google JavaScript and put the 3-second performance target at risk.
- Deployment to your host is quoted separately.
- No accounts, backend, analytics or content administration — outside the agreed scope.

## File map

```
index.html          Structure and three views
styles.css          Design tokens, layout, responsive rules
app.js              All logic (~540 lines, commented)
data/events.json    Content — edit this to change events
acceptance.mjs      Automated acceptance checks (dev only)
package.json        Playwright dependency (dev only)
PROPOSAL.md         Submitted proposal
BID.txt             Short bid text
```
