# Lessons Learned

> This file is maintained by AI agents working on this project.
> It captures validated, reusable insights discovered during development.
> **Read this file at the start of every task. Update it at the end of every iteration.**

## How to Use This File

### Reading (Start of Every Task)
Before starting any work, read this file to avoid repeating known mistakes
and to leverage proven approaches.

### Writing (End of Every Iteration)
After completing a task or iteration, evaluate whether any new insight was
gained that would be valuable for future sessions. If yes, add it to the
appropriate category below.

### Promotion from Iteration Log
Patterns that appear 2+ times in `ITERATION_LOG.md` should be promoted
here as a validated lesson.

### Pruning
If a lesson becomes obsolete (e.g., a dependency was removed, an API changed),
move it to the Archive section at the bottom with a date and reason.

---

## Architecture & Design Decisions

**[2026-02-14]** STB API returns protobuf, not JSON — The `info.stb.ro` API endpoint returns Protocol Buffers binary despite sending an `Accept: application/json` header. A custom ~100-line decoder (`proto.ts`) handles this. No protobuf library is needed since the schema is small and stable.

**[2026-02-15]** Server-side proxy is required — The STB API requires custom headers (`User-Info`, `App-Id`, `Lang`, etc.) that CORS blocks from browsers. A proxy injects these headers server-side. Vite plugin for dev (`/stb-api/*`), Cloudflare Worker for production.

**[2026-07-19]** New STB API paths need explicit dev/production proxy parity — The Vite dev proxy currently forwards any `/stb-api/*` target, while the production Cloudflare Worker only allows `/lines/stop`. Any route or vehicle-position endpoint must be allowlisted and validated in production as part of the same change, or it can pass locally and fail after deployment.

**[2026-02-15]** STB API requires User-Info auth token — The API returns 400 without a `User-Info` header. Get a bcrypt token from `GET /proxy/user/auth` (requires `App-key` and `App-Id` headers). Token expires (412 response) and must be re-fetched. The official STB web app does this automatically.

**[2026-02-15]** STB auth credentials — `App-key` and `App-Id` values are extracted from the official STB web app's main JS bundle. They are stored in environment variables (`STB_APP_KEY`, `STB_APP_ID`), not in source code. See `.env.example` for setup. If auth stops working, re-check the bundle at `info.stb.ro/main-es2015.*.js` and update `.env`.

## Code Patterns & Pitfalls

**[2026-02-14]** DOMException.name is read-only — When mocking `AbortError` in tests, use the constructor `new DOMException('message', 'AbortError')` instead of `Object.assign(new DOMException(...), { name: 'AbortError' })`. The `name` property on `DOMException` is a getter and cannot be overwritten.

**[2026-07-20]** Usability checks are not automatically type guards — A predicate such as “has at least two path points” can be false for a valid `ArrivalInfo`. Declaring it as `arrival is ArrivalInfo` incorrectly narrows the false branch to `null`; return `boolean` unless the true branch represents a real subtype.

**[2026-02-15] Corrected [2026-07-19]** Protobuf arrival data is in field 9 sub-messages — Field 6 is the optional/redundant first-arrival value. The real arrival list lives in repeated field 9 messages with `{1: timetable/scheduled flag, 2: seconds, 3: accessibility flag}`. Field 8 is a `0|1` route direction, not an arrival value or constant; the official app passes it as the `direction` query parameter.

**[2026-07-19]** Selected-line maps use the existing stop endpoint — Request `/lines/stop?stop_id={sourceStopId}&selected_line_id={lineId}&direction={0|1}`. The selected line gains field 11, a standard Google encoded polyline, and repeated field 12 vehicle messages with ID, fixed64 latitude/longitude, transport type, and an accessibility flag. The response still contains all station arrivals, so use it as the normal refresh response instead of adding a duplicate route/vehicle poll.

**[2026-07-19]** Preserve the source stop ID for selectable merged arrivals — Surface arrivals use the selected station ID, but metro arrivals are merged from platform-specific API stop IDs. A route-map request must use the platform stop that produced the tapped line/direction; line ID and display direction alone are insufficient after merging.

**[2026-07-20]** Selected-line polling should fetch both directions as one snapshot — Start the tapped direction and its `0|1` inverse concurrently, keep one 20-second poll, and publish only after both settle. STB only returns selected geometry when `stop_id` is served in the requested direction; if the tapped platform cannot provide the inverse, discover it once among stops nearest the primary route's opposite terminus and cache that source stop. This exposes vehicles approaching a first stop without projection heuristics. On partial failure, preserve last-known geometry but clear vehicles for the failed direction so stale coordinates never masquerade as live.

**[2026-02-15]** GTFS stop_id maps to STB API stop_id — ROTI GTFS feed uses format `1008-{numeric_id}` where the numeric suffix is the STB API `stop_id`. Filter to Bucharest bounding box (lat 44.3-44.6, lon 25.9-26.3) to get ~2710 valid stations.

**[2026-02-15]** Leaflet lazy-loading pattern — Use `Promise.all([import('leaflet'), import('./tiles.js'), ...])` to load Leaflet and map utilities in parallel after initial render. Import CSS dynamically too: `await import('leaflet/dist/leaflet.css')`. Show a loading skeleton while the map initializes.

**[2026-02-15]** Svelte 5 `$state` in store factories — When a store factory reads `$state` variables (e.g., `settings.theme`), don't pass them directly to non-reactive functions during initialization. Capture the initial value in a plain variable first: `const initial = { theme: stored?.theme ?? 'dark' }; applyTheme(initial.theme);`. This avoids the `state_referenced_locally` warning.

**[2026-02-15]** Svelte 5 `$effect` dependency tracking requires unconditional reads — `$effect` only tracks reactive values (`$state`, `$derived`, `$props`) that are read during execution. If a guard using plain `let` variables short-circuits before a prop is read (e.g., `if (!map) return` before reading `theme`), Svelte records zero dependencies and the effect never re-runs. Fix: read all reactive values at the top before any guards: `const t = theme; if (!map) return; use(t);`.

**[2026-02-15]** GTFS metro parent station IDs ≠ STB API subway stop IDs — The STB API uses internal stop IDs (9500–9757) for subway stations, not the GTFS parent station IDs (14xxx, 15xxx, 57xxx). Each physical station has 2+ API stops (one per platform/direction). The mapping is stored in `src/lib/stations/subway-stops.ts` and was discovered via `scripts/discover-subway-stops.ts`. M5 (Drumul Taberei) stations have no API data.

**[2026-02-15]** Multi-stop fetch+merge pattern for metro stations — `fetchArrivals()` accepts `number | number[]`. For arrays, use `Promise.allSettled` (not `Promise.all`) to tolerate partial failures. Merge by concatenating arrivals from all successful fetches and re-sorting. This way, one failing platform doesn't crash the entire station's view.

**[2026-05-07]** Search queries should normalize internal whitespace before matching — Users may paste station names with repeated spaces. Collapse whitespace in the shared normalizer so exact/contains matches still work after trimming and diacritic folding.
**[2026-05-12]** Station search should ignore punctuation in names and queries — Abbreviations like `C.F.R.` and hyphenated names should normalize to plain alphanumerics so users can search `CFR Progresul` or similar without matching literal punctuation.
**[2026-05-16]** Station search should treat dash separators as spaces — ASCII hyphens and typographic dashes in names/queries should become spaces before punctuation stripping, or compounds like `Piața–Unirii — Nord` collapse into a single token and stop matching plain queries.

**[2026-05-14]** Codemap entries should be verified against the actual component file list after deletions — `docs/codemap.md` can lag when a file like `RefreshButton.svelte` is removed, so check `src/lib/components/*.svelte` before syncing the directory tree.

**[2026-05-17]** Unicode normalization should strip decomposed combining marks after the Romanian character map — Pasted station names can encode Romanian letters as base letters plus combining marks (for example `S\u0326`). Apply `normalize('NFD')` and remove `\u0300-\u036f` after the explicit `ă/ș/ț/ş/ţ` map, and keep period removal separate so acronym searches like `C.F.R.` still normalize to `cfr`.

## Testing & Quality

**[2026-02-14]** Protobuf tests need encoding helpers — Tests for the protobuf decoder require building valid binary messages. Use `encodeVarint`, `encodeStringField`, `encodeVarintField`, and `encodeMessageField` helpers (defined in `proto.test.ts`) to construct test fixtures.

**[2026-02-15]** E2E tests must run serially (1 worker) — Playwright tests hit the Vite dev proxy which makes real API calls. Running multiple workers in parallel causes auth token race conditions and 15s timeouts. Set `workers: 1` in `playwright.config.ts`.

**[2026-02-15]** Exclude integration and E2E tests from `npm test` — Vitest picks up `*.integration.test.ts` and Playwright's `e2e/` files unless explicitly excluded. Use `--exclude` flags in the test script. Integration tests use a separate vitest config (`vitest.integration.config.ts`).

**[2026-05-15]** Verify actual Vitest output before syncing test-count docs — `docs/codemap.md` test totals can drift as new unit tests are added. Use the live `npm test` summary as the source of truth before updating the documented suite count.

**[2026-05-15]** Vitest does not accept Jest's `--runInBand` flag — use the repo's plain `npm test` script or Vitest-native concurrency flags instead. Passing Jest-only flags through the npm script fails fast with `Unknown option`, so verify the runner's CLI before reusing muscle memory from another test tool.

## Performance & Infrastructure

**[2026-02-14]** CI runs type-check, tests, then build — The GitHub Actions workflow (`deploy.yml`) runs `npm run check`, `npm test`, and `npm run build` in sequence. It also runs on PRs (not just main branch pushes), with deploy only on main/master.

## Dependencies & External Services

**[2026-02-14]** STB API endpoint is `info.stb.ro`, not `info.stbsa.ro` — The older `info.stbsa.ro` domain was used by previous versions of the API. The current v2-6 endpoint is at `info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570`.

**[2026-02-14] Corrected [2026-02-18]** package-lock.json is tracked in git — Despite an earlier note claiming it was gitignored, `package-lock.json` is tracked and must be committed with dependency changes.

**[2026-02-18]** npm `overrides` for transitive vulnerability fixes — When a transitive dependency has a CVE but the direct dependency hasn't updated its semver range, use `"overrides"` in `package.json` to force the patched version. For 0.x versions, caret ranges like `^0.6.0` only allow `>=0.6.0 <0.7.0`, so an override is the only way to get 0.7.x. Example: `@sveltejs/kit` pins `cookie: "^0.6.0"` but the CVE fix requires `>=0.7.0`.

## Timezone & Date Boundaries

**[2026-02-16]** Transit day boundary is 4 AM Romanian time, not midnight or 24h rolling — STB transit schedules reset around 4 AM (last services end, first services start). Use `Intl.DateTimeFormat.formatToParts()` with `timeZone: 'Europe/Bucharest'` to get the hour, then subtract 1 from the day number if hour < 4. This correctly handles DST transitions (EET/EEST) without hardcoding UTC offsets.

## Process & Workflow

**[2026-02-15]** Romanian time pluralization — "oră" (singular, 1 hour) vs "ore" (plural, 2+ hours). Format: "acum" (<30s), "X min" (1-59), "1 oră, Y min" (60-119), "X ore, Y min" (120+).

---

## Archive

**[2026-02-14] Archived [2026-02-15]** No backend required — Superseded: the STB API now requires `User-Info` auth token, which means a proxy is mandatory. The "no backend" architecture is no longer viable.

**[2026-02-14] Archived [2026-02-15]** Custom headers cause CORS preflight failures / API works without them — Partially wrong: the API does NOT work without custom headers (returns 400). The CORS part is still true, but the fix is a proxy that injects headers, not omitting them.

**[2026-02-14] Archived [2026-02-15]** TRAM_LINES is a Set, not an array — Removed: `TRAM_LINES`, `LINE_ORDER`, and `LINE_COLORS` were deleted during the redesign. The app now shows all transport types and uses API-provided colors.

**[2026-02-14] Archived [2026-02-15]** Arrival time field mapping is tentative — Resolved: protobuf field mapping has been confirmed. Arrival data is in field 9 sub-messages, not fields 6/7/8. See `docs/proto-analysis.md` for evidence.

**[2026-07-19] Archived [2026-07-20]** Directional vehicle fallback must fail closed — Superseded by always fetching and displaying both route directions. The projection and turnaround heuristics added complexity while still hiding useful opposite-direction vehicles outside their narrow fallback conditions.
