# Iteration Log

> Append-only journal of AI agent work sessions on this project.
> **Add an entry at the end of every iteration.**
> When patterns emerge (same issue 2+ times), promote to `LESSONS_LEARNED.md`.

## Format

Each entry should follow this structure:

---

### [YYYY-MM-DD] Brief Description of Work Done

**Context:** What was the goal / what triggered this work
**What happened:** Key actions taken, decisions made
**Outcome:** Result — success, partial, or failure
**Insight:** (optional) What would you tell the next agent about this?
**Promoted to Lessons Learned:** Yes/No

---

### [2026-02-14] Switch to real STB API with protobuf decoding

**Context:** The app was using speculative multi-API fallback code (mo-bi.ro, info.stbsa.ro) without a confirmed working endpoint. User discovered the real endpoint at `info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570` and shared the raw protobuf response.
**What happened:** Wrote a minimal protobuf wire-format reader (`proto.ts`, ~100 lines). Rewrote `arrivals.ts` to decode the binary response. Removed all the old multi-API fallback code. Updated constants with stop_id=3570 and the correct API headers. Updated types to match the real response structure (lineName, lineId, vehicleType, color, direction, arrivingTimes).
**Outcome:** Success — type-check passes, build succeeds. Arrival time field mapping (fields 6, 7, 8) is educated guessing from hex dump analysis and needs real-world validation.
**Insight:** The STB API ignores the `Accept: application/json` header and always returns protobuf. Don't waste time trying to get JSON out of it. The hex dump from `hexdump -C` is invaluable for reverse-engineering the protobuf schema.
**Promoted to Lessons Learned:** Yes

---

### [2026-02-14] Add tests, documentation, AGENTS.md, and CI improvements

**Context:** Project had no tests, no docs folder, no AGENTS.md, and the CI workflow only ran `build` without checks.
**What happened:** Installed vitest. Wrote 29 tests across 4 files covering protobuf decoding, HTTP client, arrival parsing, and format helpers. Hit a gotcha where `DOMException.name` is read-only (can't use `Object.assign`). Created `docs/` with architecture.md, codemap.md, and api.md. Created AGENTS.md with tech stack, required experience, UX guidelines. Updated README with build badge and live app link. Updated CI to run type-check and tests on PRs.
**Outcome:** Success — 29 tests pass, 0 type errors, build succeeds.
**Insight:** The `DOMException` constructor accepts the name as the second argument: `new DOMException('msg', 'AbortError')`. This is the correct way to create named DOMExceptions in tests.
**Promoted to Lessons Learned:** Yes

---

### [2026-02-14] Add lessons learned memory system

**Context:** Need a persistent learning system so AI agents accumulate wisdom across sessions.
**What happened:** Created `LESSONS_LEARNED.md` with categorized insights from previous iterations. Created `ITERATION_LOG.md` with session journal entries. Updated `AGENTS.md` with a "Memory & Continuous Learning" section describing the required workflow.
**Outcome:** Success — both files created, AGENTS.md updated, all seeded with initial entries from the project's history.
**Insight:** Seeding the files with real entries from past work is more useful than leaving them empty. Future agents immediately see the format and depth expected.
**Promoted to Lessons Learned:** No (meta-process, not project-specific)

---

### [2026-02-14] Fix CORS error caused by custom request headers

**Context:** The deployed app on `fabian20ro.github.io` was failing with: `Request header field lang is not allowed by Access-Control-Allow-Headers in preflight response`. All API calls were blocked.
**What happened:** The STB API headers (`App-Id`, `App-Version`, `Device-Name`, `Lang`, `Source`) are non-standard and trigger a CORS preflight (OPTIONS) request. The STB server responds to the preflight but doesn't include these headers in `Access-Control-Allow-Headers`, so the browser rejects the request. Fixed by removing all custom headers from `API.HEADERS` in `constants.ts`. Updated the test in `client.test.ts` to verify custom headers are not sent. Updated `docs/api.md` to document the CORS behavior.
**Outcome:** Success — 29 tests pass, 0 type errors, build succeeds. The API is expected to work without custom headers since it serves the same protobuf response regardless.
**Insight:** The STB API server has partial CORS support (it responds to OPTIONS) but doesn't allow custom headers. Avoid sending any non-CORS-safelisted headers from browser context.
**Promoted to Lessons Learned:** Yes

---

### [2026-02-15] Fix STB API integration: proxy + auth + testing

**Context:** The deployed app was failing with 400 Bad Request. Previous fix (removing custom headers) turned the CORS error into a 400 because the STB API actually requires those headers (including a `User-Info` auth token). This created a catch-22: headers needed but CORS-blocked.

**What happened:**
1. Discovered the STB API now requires a `User-Info` header (bcrypt hash). Without it: `Missing request header 'User-Info'` (400). With expired token: 412.
2. Found the auth endpoint by reverse-engineering the STB web app's JS bundle: `GET /proxy/user/auth` with `App-key` and `App-Id` headers returns a token.
3. Built a Vite plugin (`stbProxy`) that acts as a middleware, fetching auth tokens lazily and retrying on 412.
4. Created integration tests that verify the real API works (5 tests, all pass with auth).
5. Set up Playwright E2E tests (10 tests across Desktop + Mobile Chrome).
6. Created a Cloudflare Worker (`worker/src/index.ts`) for production proxy with path whitelist and CORS.
7. Updated all documentation (api.md, architecture.md, codemap.md).

**Files created:** `stb-api.integration.test.ts`, `vitest.integration.config.ts`, `playwright.config.ts`, `e2e/arrival-board.spec.ts`, `worker/src/index.ts`, `worker/wrangler.toml`, `worker/package.json`, `worker/tsconfig.json`, `.env.example`

**Files modified:** `vite.config.ts`, `src/lib/api/constants.ts`, `src/app.d.ts`, `package.json`, `.gitignore`, `docs/api.md`, `docs/architecture.md`, `docs/codemap.md`, `LESSONS_LEARNED.md`

**Outcome:** Success — 29 unit tests pass, 5 integration tests pass, 10 E2E tests pass, 0 type errors. The app loads real tram data through the Vite dev proxy.

**Insight:** The STB API's auth endpoint and credentials are embedded in the official web app's JS bundle at `info.stb.ro/main-es2015.*.js`. Look for `userInfoAppKey` and `getAuthToken`. Vite's `server.proxy.headers` is great for static headers, but dynamic auth needs a custom plugin with `configureServer` middleware.

**Promoted to Lessons Learned:** Yes (proxy architecture, auth flow, E2E serialization)

---

### [2026-02-15] Deploy Cloudflare Worker + auto-deploy via Git integration

**Context:** Worker was deployed manually via `wrangler deploy`. Needed to set up auto-deploy so the worker redeploys on push without remembering CLI commands.

**What happened:**
1. Deployed worker to `https://better-stb-proxy.fabian20ro.workers.dev` via `npx wrangler deploy`.
2. Created `.env.production` with the worker URL, un-ignored it in `.gitignore` (it's not a secret).
3. Connected the GitHub repo to Cloudflare via dashboard: Workers & Pages > `better-stb-proxy` > Settings > Build > Connect to Git.
4. Configured: build command = `npm install`, deploy command = `npx wrangler deploy`, root directory = `worker`, build watch paths = `worker/*`.
5. Cloudflare auto-created a "Workers Builds" API token for the integration.
6. Wrote comprehensive `docs/deployment.md` with architecture diagram, all Cloudflare settings, troubleshooting tables, and nuclear redeploy instructions.

**Key settings for Cloudflare Git integration:**
- Root directory must be `worker` (not `/`) so commands run in the right context
- Build watch paths = `worker/*` to avoid unnecessary deploys on frontend-only changes
- Build command = `npm install` (installs wrangler), Deploy command = `npx wrangler deploy`

**Outcome:** Success — both frontend (GitHub Pages) and worker (Cloudflare) now auto-deploy on push to `main`. Worker only redeploys when `worker/*` files change.

**Insight:** Cloudflare's Git integration for Workers has separate "build command" and "deploy command" fields. The build command runs first (use it for `npm install`), then the deploy command runs (use it for `npx wrangler deploy`). The "root directory" setting changes the working directory for both commands, which is essential for monorepos where the worker lives in a subdirectory.

**Promoted to Lessons Learned:** No (deployment config, not a code pattern)

---

### [2026-02-15] Complete app redesign: map, GPS, multi-station, favorites, i18n

**Context:** The app was a text-only dark-themed board showing hardcoded tram arrivals for a single station (Piata Unirii). Arrival times were wrong (showed "1 min" for everything due to incorrect protobuf field mapping). The goal was a full redesign: map-priority layout, GPS-based station discovery, all transport types, favorites/recents, theme toggle, language toggle.

**What happened:**
1. **Phase 0 — Diagnosed arrival bug:** Created `scripts/dump-proto.ts` to dump all protobuf fields from live API. Discovered fields 6/7/8 are NOT three arrival times — field 6 = first arrival (redundant), field 7 = always 0, field 8 = always 1. Real arrival data lives in field 9 as repeated sub-messages with `{1: is_scheduled, 2: seconds}`.
2. **Phase 1 — Fixed arrivals:** Rewrote `arrivals.ts` to read field 9 sub-messages. Added hour formatting in Romanian ("oră"/"ore"). Made `fetchArrivals()` accept dynamic `stopId`. Removed tram-only filter.
3. **Phase 2 — Station data:** Found GTFS data from ROTI (4665 stops). Mapped GTFS `1008-{stb_id}` → STB API `stop_id`. Extracted 2710 Bucharest stations. Created geo utilities (Haversine), fuzzy search with diacritics stripping, IndexedDB caching with 24h staleness.
4. **Phase 3 — Map:** Installed Leaflet. Created MapView with lazy loading, station markers, user GPS dot. Map utilities for icons, tiles (CartoDB Voyager/Dark Matter), user marker.
5. **Phase 4 — Layout:** Rewrote `+page.svelte` with split layout (arrivals panel top, square map bottom). Created StationHeader, StationArrivals components. Updated ArrivalRow to use API-provided colors.
6. **Phase 5 — Features:** Favorites store (localStorage), recents store (max 5, FIFO), settings store (theme/lang). DrawerMenu with slide-in navigation. i18n system (RO+EN). Parallel startup: favorites-first → cached arrivals → fresh fetch, stations in background, GPS parallel.
7. **Phase 6 — Polish:** Light+dark themes in CSS. PWA updates (StaleWhileRevalidate for map tiles). E2E tests rewritten for new UI (15 tests across 6 describe blocks). Documentation updated.

**Files created:** 25+ new files across stations/, stores/, components/, map/, i18n/, scripts/, docs/
**Files modified:** constants.ts, arrivals.ts, arrivals store, ArrivalRow, +page.svelte, app.css, app.html, vite.config.ts, .gitignore

**Outcome:** Success — 63 unit tests pass, 6 integration tests pass, build succeeds, 0 type errors.

**Insight:**
- Protobuf field 9 repeated sub-messages are the correct source for arrival times. Fields 6/7/8 are metadata (first arrival shortcut, unknown flags).
- GTFS stop_id format `1008-{number}` maps directly to STB API stop_id.
- Leaflet lazy-loading via `Promise.all([import('leaflet'), ...])` keeps the initial bundle small (~43KB gzip deferred).
- Svelte 5 `$state` in stores requires careful handling — avoid referencing reactive state in non-reactive contexts (use closure variables for initial values).

**Promoted to Lessons Learned:** Yes

---

### [2026-02-15] Dynamic map stations + theme tile fix

**Context:** Two usability bugs: (1) Map only showed 15 stations nearest to GPS. Panning/zooming the map didn't load new stations — no `moveend`/`zoomend` handlers existed. (2) Toggling light/dark theme didn't switch map tiles. Root cause: Svelte 5 `$effect` dependency tracking bug — the theme effect guarded on plain `let` variables (`map`, `tileLayer`) which short-circuited before reading the reactive `theme` prop, so Svelte recorded zero dependencies.

**What happened:**
1. Added `findStationsInBounds()` to `geo.ts` — filters 2710 stations by viewport bounds, caps at 100, sorts overflow by distance to center, always includes selected station. 6 new tests.
2. Fixed theme `$effect` — read `theme` prop before the null-guard so Svelte always tracks it: `const t = theme; if (!map || ...) return;`.
3. Refactored MapView: replaced `stationMarkers: L.Marker[]` with `markerCache: Map<number, L.Marker>` for diff-based updates. Added debounced `moveend` handler (150ms). Replaced per-update `fitBounds()` with one-time `setInitialView()`. Added cleanup for debounce timer and marker cache.
4. Simplified `+page.svelte`: removed `nearbyStations`, `updateNearbyStations()`, and GPS-triggered `$effect`. MapView now receives `allStations` and owns viewport-based filtering internally.

**Outcome:** Success — 69 unit tests pass (6 new), 0 type errors, build succeeds. Pan/zoom now loads stations dynamically, theme toggle switches tiles immediately.

**Insight:** Svelte 5 `$effect` dependency tracking only records reactive values that are actually **read** during execution. If a guard condition (`if (!plainLetVar)`) short-circuits before a `$props` value is read, the effect has zero dependencies and never re-runs. Fix: always read all reactive values unconditionally at the top of the effect body, before any guards.

**Promoted to Lessons Learned:** Yes

---

### [2026-02-15] Add subway support with multi-stop merging + larger markers

**Context:** Metro stations existed in the station list (59 GTFS parent stations) but their IDs returned no data from the STB API. The API uses separate internal stop IDs (9500–9757) for subway stations. Each physical station has 2+ stops (one per platform/direction). Goal was to make metro arrivals work by discovering the correct IDs and merging multiple stops into one view.

**What happened:**
1. **Discovery:** Created `scripts/discover-subway-stops.ts` to brute-force scan the STB API for subway stop IDs. Found 107 stops across 47 unique station names in range 9500–9864. M5 (Drumul Taberei) has no API data.
2. **Mapping:** Created `src/lib/stations/subway-stops.ts` mapping 47 GTFS metro parent station IDs to their STB API subway stop IDs. `resolveStopIds()` returns the mapped IDs or `[stationId]` for surface transport.
3. **Multi-stop fetch:** Updated `fetchArrivals()` in `arrivals.ts` to accept `number | number[]`. When given an array, fetches all in parallel via `Promise.allSettled`, merges arrivals, re-sorts by line name. Partial failures tolerated.
4. **Store update:** Updated `arrivals.svelte.ts` to resolve station IDs through the subway mapping before fetching.
5. **Marker sizes:** Doubled all map marker dot sizes (normal: 12→24px, selected: 18→36px). Updated tooltip offset to match.
6. **SUBWAY color:** Added `SUBWAY: '#1D1D1B'` to `TYPE_COLORS` in station-icons.ts.
7. **Tests:** Added 5 new tests for multi-stop merging (parallel fetch, sorting, partial failures, total failure, backward compat). All 74 tests pass.

**Files created:** `scripts/discover-subway-stops.ts`, `src/lib/stations/subway-stops.ts`
**Files modified:** `src/lib/api/arrivals.ts`, `src/lib/stores/arrivals.svelte.ts`, `src/lib/api/arrivals.test.ts`, `src/lib/components/map/station-icons.ts`, `src/lib/components/MapView.svelte`, docs/*, AGENTS.md, README.md

**Outcome:** Success — 74 unit tests pass, 0 type errors, build succeeds. Metro stations now show M1/M2/M3/M4 arrivals with merged multi-platform data.

**Insight:**
- GTFS metro parent station IDs ≠ STB API subway stop IDs. The API uses its own numbering (9500–9757 range).
- `Promise.allSettled` is essential for multi-stop fetch — one failing platform shouldn't crash the whole request.
- M5 (Drumul Taberei) line has no API data despite having GTFS station entries (99010–99090).
- Some stations have duplicate stop IDs (e.g., Dristor has 4 stops, 2 seem redundant but we include all for completeness).

**Promoted to Lessons Learned:** Yes

---

### [2026-02-15] Add build status badge and last data update timestamp to drawer

**Context:** User wanted visibility into when station data was last refreshed (daily morning updates) and a build status indicator, both shown in the hamburger drawer.

**What happened:**
1. **TDD:** Wrote 4 tests for `formatLastUpdate(timestamp, lang)` helper — empty on 0, Romanian locale, English locale, time component. Tests failed (RED), then implemented the function using `Intl.DateTimeFormat` with locale-aware formatting (GREEN).
2. **format.ts:** Created `src/lib/stations/format.ts` with a pure function using `Intl.DateTimeFormat` for locale-aware date+time formatting.
3. **DrawerMenu:** Added `lastDataUpdate` prop, imported `formatLastUpdate`, and displayed it above the build badge with bilingual label ("Date actualizate" / "Data updated").
4. **+page.svelte:** Imported `getLastRefreshTime` from `db.ts`, fetched timestamp in `onMount` (parallel with station loading), passed as prop to DrawerMenu.
5. **Docs:** Updated codemap.md (new files, test count 74→78, dependency graph), architecture.md (drawer items), AGENTS.md (drawer description, test count).

**Files created:** `src/lib/stations/format.ts`, `src/lib/stations/format.test.ts`
**Files modified:** `src/lib/components/DrawerMenu.svelte`, `src/routes/+page.svelte`, `docs/codemap.md`, `docs/architecture.md`, `AGENTS.md`

**Outcome:** Success — 78 unit tests pass, 0 type errors, build succeeds.

**Insight:** `Intl.DateTimeFormat` is the right choice for locale-aware timestamps in a bilingual app — no i18n library needed for date formatting, and it follows the user's language toggle naturally.

**Promoted to Lessons Learned:** No (straightforward feature)

---

### [2026-02-16] Fix daily update trigger — use 4 AM Romanian time boundary

**Context:** User reported that "Date actualizate" in the drawer still showed "15 feb. 2026, 11:06" on Feb 16. The staleness check used a fixed 24-hour window, so data refreshed at 11:06 wouldn't trigger a new check until 11:06 the next day. User expects a new day to start at 4 AM Romanian time.

**Root cause (two issues):**
1. `STALE_THRESHOLD_MS = 24h` — a fixed duration doesn't align with calendar days. Data refreshed at 11:06 isn't stale until 11:06 tomorrow, missing the 4 AM morning boundary.
2. `fetchFreshStations()` always returns `[]` (can't parse GTFS ZIP in browser), so even when the check triggers, the timestamp never updates.

**What happened:**
1. Replaced the 24h threshold with `isNewRomanianDay(lastRefreshMs)` — uses `Intl.DateTimeFormat` with `timeZone: 'Europe/Bucharest'` to compute a "Romanian day number" where the day boundary is 4 AM, not midnight.
2. Added `updateLastRefreshTime()` to `db.ts` — updates only the meta timestamp without re-saving all 2710 stations.
3. In `checkAndRefresh()`, when fresh GTFS data isn't available (empty response), still call `updateLastRefreshTime()` to mark today as verified.
4. Changed `loadStations()` return type to `{ stations, refreshDone }` so `+page.svelte` can re-read the timestamp after the background check completes.
5. Wrote 8 tests for `getRomanianDayNumber()` and `isNewRomanianDay()`.

**Files created:** `src/lib/stations/data.test.ts`
**Files modified:** `src/lib/stations/data.ts`, `src/lib/stations/db.ts`, `src/routes/+page.svelte`

**Outcome:** Success — 86 unit tests pass, 0 type errors.

**Insight:** `Intl.DateTimeFormat.formatToParts()` with `timeZone: 'Europe/Bucharest'` is the correct way to do timezone-aware date math in the browser without a library. The "day number" pattern (floor UTC day, subtract 1 if before boundary hour) is a clean way to compare transit days.

**Promoted to Lessons Learned:** Yes

---

### [2026-02-16] Move API credentials from source code to environment variables

**Context:** Security assessment flagged hardcoded STB API credentials (`APP_ID`, `APP_KEY`) in 4 source files plus docs. These credentials were committed to git, exposing them to anyone with repo access.

**What happened:**
1. **constants.ts:** Replaced `STB_AUTH` (with hardcoded credentials) and `STB_SERVER_HEADERS` with `STB_AUTH_PATH` (just the path string) and `createStbServerHeaders(appId)` (a function that builds headers from a provided appId).
2. **vite.config.ts:** Switched from importing credentials to using Vite's `loadEnv()` to read `STB_APP_ID` and `STB_APP_KEY` from `.env` files. Passes credentials to the `stbProxy()` plugin as parameters.
3. **worker/src/index.ts:** Added `Env` interface with `STB_APP_ID` and `STB_APP_KEY` bindings. Worker fetch handler now receives `env` parameter from Cloudflare runtime. Credentials set via `wrangler secret put`.
4. **scripts/dump-proto.ts, discover-subway-stops.ts:** Added `import 'dotenv/config'` and read credentials from `process.env`. Exit with clear error message if missing.
5. **Integration test:** Updated to read credentials from `process.env` (vitest loads `.env` automatically).
6. **docs/api.md:** Replaced all hardcoded credential values with `$STB_APP_ID` / `$STB_APP_KEY` env var references.
7. **docs/deployment.md:** Added "STB API secrets" section with `wrangler secret put` commands.
8. **Created `.env`** (gitignored) with actual credential values for local dev.
9. **Updated `.env.example`** with placeholder entries for `STB_APP_ID` and `STB_APP_KEY`.
10. **Added `dotenv`** as a dev dependency for scripts.

**Files modified:** `src/lib/api/constants.ts`, `vite.config.ts`, `worker/src/index.ts`, `scripts/dump-proto.ts`, `scripts/discover-subway-stops.ts`, `src/lib/api/stb-api.integration.test.ts`, `.env.example`, `docs/api.md`, `docs/codemap.md`, `docs/deployment.md`, `LESSONS_LEARNED.md`, `package.json`
**Files created:** `.env` (gitignored)

**Outcome:** Success — 86 unit tests pass, 0 type errors, build succeeds. No hardcoded credentials remain in any tracked files.

**Insight:** When moving secrets to env vars in a multi-runtime project (Vite + Cloudflare Workers + Node scripts), each runtime has its own env loading mechanism: Vite uses `loadEnv()`, Cloudflare Workers use `env` bindings (secrets), and Node scripts need `dotenv`. A shared constants file can export a factory function instead of pre-built objects to avoid needing `process.env` in browser-safe modules.

**Promoted to Lessons Learned:** Yes (updated existing entry about STB auth credentials)

---

### [2026-02-16] Improve PWA installability — iOS support + manifest enhancements

**Context:** User requested PWA installability analysis. The app already had solid PWA infrastructure via `@vite-pwa/sveltekit` (manifest, service worker, Workbox caching), making it installable on Android/desktop. However, iOS "Add to Home Screen" was missing Apple-specific meta tags and touch icon.

**What happened:**
1. Generated `icon-180x180.png` from the existing 512x512 icon (Pillow resize with LANCZOS).
2. Added iOS meta tags to `app.html`: `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`.
3. Fixed light theme-color mismatch: `settings.svelte.ts` used `#ffffff` for light theme but CSS `--color-bg` is `#f5f5f7`. Updated to match.
4. Enhanced manifest: added `scope`, `orientation: portrait-primary`, `categories: ['travel', 'utilities']`, and the 180x180 icon entry.

**Files created:** `static/icons/icon-180x180.png`
**Files modified:** `src/app.html`, `src/lib/stores/settings.svelte.ts`, `vite.config.ts`

**Outcome:** Success — 86 unit tests pass, 0 type errors (svelte-check clean).

**Insight:** iOS Safari doesn't fully respect the web app manifest — it requires proprietary `apple-mobile-web-app-*` meta tags and `apple-touch-icon` link for proper "Add to Home Screen". The dynamic theme-color update was already implemented but had a color mismatch with the CSS theme variables.

**Promoted to Lessons Learned:** No (straightforward PWA config)

---

### [2026-02-16] Upgrade dependencies to latest available versions

**Context:** Routine dependency upgrade to keep packages current.

**What happened:**
1. Checked latest versions for all dependencies in root `package.json` and `worker/package.json`.
2. Updated root package.json:
   - `@sveltejs/kit`: ^2.50.2 → ^2.52.0
   - `svelte`: ^5.49.2 → ^5.51.2
   - `svelte-check`: ^4.3.6 → ^4.4.0
3. Updated worker/package.json:
   - `@cloudflare/workers-types`: ^4.20250214.0 → ^4.20260214.0
   - `wrangler`: ^4.11.0 → ^4.65.0
4. Already at latest: @playwright/test, @sveltejs/adapter-static, @sveltejs/vite-plugin-svelte, @types/leaflet, @types/node, dotenv, typescript, vite, vite-plugin-pwa, vitest, @vite-pwa/sveltekit, leaflet.
5. Verified: `npm run check` (0 errors), `npm test` (86 tests pass), `npm run build` (success).

**Outcome:** Success — all dependencies upgraded, type check clean, all tests pass, build succeeds.

**Promoted to Lessons Learned:** No (routine maintenance)

---

### [2026-02-18] Fix cookie CVE-2024-47764 via npm overrides

**Context:** Dependabot alert #1 flagged `cookie` < 0.7.0 (transitive dependency via `@sveltejs/kit`) for accepting out-of-bounds characters in cookie name, path, and domain, enabling XSS and cookie injection attacks.

**What happened:**
1. Investigated the dependency chain: `@sveltejs/kit@2.52.0` depends on `cookie: "^0.6.0"` (which resolves to `>=0.6.0 <0.7.0` per semver caret for 0.x). The latest `@sveltejs/kit` 2.x still uses this range.
2. Confirmed via [sveltejs/kit#12903](https://github.com/sveltejs/kit/issues/12903) that the SvelteKit team won't upgrade `cookie` in 2.x because stricter validation in 0.7.0 is a breaking change. The fix is deferred to SvelteKit 3.
3. Added `"overrides": { "cookie": "^0.7.0" }` to `package.json` to force the patched version.
4. Ran `npm install` — `cookie@0.7.2` installed, `npm audit` reports 0 vulnerabilities.
5. Verified: type check clean, 86 tests pass, build succeeds.

**Files modified:** `package.json`, `package-lock.json`

**Outcome:** Success — vulnerability patched, all checks pass.

**Insight:** npm `overrides` is the standard workaround when a transitive dependency has a vulnerability but the direct dependency hasn't updated its semver range. For 0.x versions, caret `^0.6.0` only allows patch updates (`<0.7.0`), so the override is necessary.

**Promoted to Lessons Learned:** No (standard npm override pattern)

---

<!-- New entries go above this line, most recent first -->
