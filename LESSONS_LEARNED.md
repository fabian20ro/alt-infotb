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

**[2026-02-15]** STB API requires User-Info auth token — The API returns 400 without a `User-Info` header. Get a bcrypt token from `GET /proxy/user/auth` (requires `App-key` and `App-Id` headers). Token expires (412 response) and must be re-fetched. The official STB web app does this automatically.

**[2026-02-15]** STB auth credentials — `App-key: gcALgRyZHC,qFonZ=Jde`, `App-Id: b32cc233-00d7-4640-bf90-374572668c30`. These are extracted from the official STB web app's main JS bundle. If auth stops working, re-check the bundle at `info.stb.ro/main-es2015.*.js`.

## Code Patterns & Pitfalls

**[2026-02-14]** DOMException.name is read-only — When mocking `AbortError` in tests, use the constructor `new DOMException('message', 'AbortError')` instead of `Object.assign(new DOMException(...), { name: 'AbortError' })`. The `name` property on `DOMException` is a getter and cannot be overwritten.

**[2026-02-15]** Protobuf arrival data is in field 9 sub-messages — Fields 6/7/8 in the line sub-message are NOT three arrival times. Field 6 = first arrival seconds (redundant), field 7 = always 0, field 8 = always 1. The real arrival data lives in field 9 as repeated sub-messages with `{1: is_scheduled (0=GPS, 1=estimated), 2: seconds}`. See `docs/proto-analysis.md`.

**[2026-02-15]** GTFS stop_id maps to STB API stop_id — ROTI GTFS feed uses format `1008-{numeric_id}` where the numeric suffix is the STB API `stop_id`. Filter to Bucharest bounding box (lat 44.3-44.6, lon 25.9-26.3) to get ~2710 valid stations.

**[2026-02-15]** Leaflet lazy-loading pattern — Use `Promise.all([import('leaflet'), import('./tiles.js'), ...])` to load Leaflet and map utilities in parallel after initial render. Import CSS dynamically too: `await import('leaflet/dist/leaflet.css')`. Show a loading skeleton while the map initializes.

**[2026-02-15]** Svelte 5 `$state` in store factories — When a store factory reads `$state` variables (e.g., `settings.theme`), don't pass them directly to non-reactive functions during initialization. Capture the initial value in a plain variable first: `const initial = { theme: stored?.theme ?? 'dark' }; applyTheme(initial.theme);`. This avoids the `state_referenced_locally` warning.

**[2026-02-15]** Svelte 5 `$effect` dependency tracking requires unconditional reads — `$effect` only tracks reactive values (`$state`, `$derived`, `$props`) that are read during execution. If a guard using plain `let` variables short-circuits before a prop is read (e.g., `if (!map) return` before reading `theme`), Svelte records zero dependencies and the effect never re-runs. Fix: read all reactive values at the top before any guards: `const t = theme; if (!map) return; use(t);`.

**[2026-02-15]** GTFS metro parent station IDs ≠ STB API subway stop IDs — The STB API uses internal stop IDs (9500–9757) for subway stations, not the GTFS parent station IDs (14xxx, 15xxx, 57xxx). Each physical station has 2+ API stops (one per platform/direction). The mapping is stored in `src/lib/stations/subway-stops.ts` and was discovered via `scripts/discover-subway-stops.ts`. M5 (Drumul Taberei) stations have no API data.

**[2026-02-15]** Multi-stop fetch+merge pattern for metro stations — `fetchArrivals()` accepts `number | number[]`. For arrays, use `Promise.allSettled` (not `Promise.all`) to tolerate partial failures. Merge by concatenating arrivals from all successful fetches and re-sorting. This way, one failing platform doesn't crash the entire station's view.

## Testing & Quality

**[2026-02-14]** Protobuf tests need encoding helpers — Tests for the protobuf decoder require building valid binary messages. Use `encodeVarint`, `encodeStringField`, `encodeVarintField`, and `encodeMessageField` helpers (defined in `proto.test.ts`) to construct test fixtures.

**[2026-02-15]** E2E tests must run serially (1 worker) — Playwright tests hit the Vite dev proxy which makes real API calls. Running multiple workers in parallel causes auth token race conditions and 15s timeouts. Set `workers: 1` in `playwright.config.ts`.

**[2026-02-15]** Exclude integration and E2E tests from `npm test` — Vitest picks up `*.integration.test.ts` and Playwright's `e2e/` files unless explicitly excluded. Use `--exclude` flags in the test script. Integration tests use a separate vitest config (`vitest.integration.config.ts`).

## Performance & Infrastructure

**[2026-02-14]** CI runs type-check, tests, then build — The GitHub Actions workflow (`deploy.yml`) runs `npm run check`, `npm test`, and `npm run build` in sequence. It also runs on PRs (not just main branch pushes), with deploy only on main/master.

## Dependencies & External Services

**[2026-02-14]** STB API endpoint is `info.stb.ro`, not `info.stbsa.ro` — The older `info.stbsa.ro` domain was used by previous versions of the API. The current v2-6 endpoint is at `info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570`.

**[2026-02-14]** package-lock.json is gitignored — The project's `.gitignore` excludes `package-lock.json`. Don't try to `git add` it.

## Process & Workflow

**[2026-02-15]** Romanian time pluralization — "oră" (singular, 1 hour) vs "ore" (plural, 2+ hours). Format: "acum" (<30s), "X min" (1-59), "1 oră, Y min" (60-119), "X ore, Y min" (120+).

---

## Archive

**[2026-02-14] Archived [2026-02-15]** No backend required — Superseded: the STB API now requires `User-Info` auth token, which means a proxy is mandatory. The "no backend" architecture is no longer viable.

**[2026-02-14] Archived [2026-02-15]** Custom headers cause CORS preflight failures / API works without them — Partially wrong: the API does NOT work without custom headers (returns 400). The CORS part is still true, but the fix is a proxy that injects headers, not omitting them.

**[2026-02-14] Archived [2026-02-15]** TRAM_LINES is a Set, not an array — Removed: `TRAM_LINES`, `LINE_ORDER`, and `LINE_COLORS` were deleted during the redesign. The app now shows all transport types and uses API-provided colors.

**[2026-02-14] Archived [2026-02-15]** Arrival time field mapping is tentative — Resolved: protobuf field mapping has been confirmed. Arrival data is in field 9 sub-messages, not fields 6/7/8. See `docs/proto-analysis.md` for evidence.
