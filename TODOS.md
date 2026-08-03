# Alt InfoTB Redesign - Progress Tracker

## Phase 0: Diagnose Arrival Time Bug
- [x] 0.1 Create diagnostic script (`scripts/dump-proto.ts`) — 2026-02-15
- [x] 0.2 Inspect official STB web app JS bundle for proto mappings — 2026-02-15
- [x] 0.3 Document findings (`docs/proto-analysis.md`) — 2026-02-15

## Phase 1: Fix Arrival Time Bug
- [x] 1.1 Update protobuf field mapping in constants.ts — 2026-02-15
- [x] 1.2 Fix time formatting for long durations (hours) — 2026-02-15
- [x] 1.3 Remove tram-only filter — 2026-02-15
- [x] 1.4 Make `fetchArrivals()` accept any stop_id — 2026-02-15
- [x] 1.5 Update tests (37 unit + 6 integration pass) — 2026-02-15

## Phase 2: Station Data Sourcing
- [x] 2.1 Find GTFS data source (ROTI, 4665 stops) — 2026-02-15
- [x] 2.2 GTFS stop_id mapping: `1008-{stb_id}` confirmed — 2026-02-15
- [x] 2.3 Create station extraction script (2710 stops extracted) — 2026-02-15
- [x] 2.4 Create station data module with IndexedDB caching — 2026-02-15
- [x] 2.5 Create geo utility (Haversine, nearest stations) — 2026-02-15
- [x] 2.6 Create station search (fuzzy, diacritics) — 2026-02-15

## Phase 3: Map Integration + Geolocation
- [x] 3.1 Install Leaflet — 2026-02-15
- [x] 3.2 Create geolocation store — 2026-02-15
- [x] 3.3 Create MapView component — 2026-02-15
- [x] 3.4 Create map utilities (icons, markers, tiles) — 2026-02-15

## Phase 4: Layout Redesign
- [x] 4.1 Implement map-priority split layout — 2026-02-15
- [x] 4.2 Design hamburger drawer — 2026-02-15
- [x] 4.3 Create main layout components — 2026-02-15
- [x] 4.4 Create station selection flow — 2026-02-15
- [x] 4.5 Update arrivals store for dynamic station — 2026-02-15

## Phase 5: Favorites, Recents, and Settings
- [x] 5.1 Favorites store — 2026-02-15
- [x] 5.2 Recents store — 2026-02-15
- [x] 5.3 Hamburger drawer component — 2026-02-15
- [x] 5.4 Theme system (light/dark) — 2026-02-15
- [x] 5.5 i18n (Romanian + English) — 2026-02-15
- [x] 5.6 Startup logic (parallel loading, favorite-first) — 2026-02-15

## Phase 6: Polish & Testing
- [x] 6.1 CSS refinements (touch targets, safe areas) — 2026-02-15
- [x] 6.2 Performance (lazy-load Leaflet, map tile caching) — 2026-02-15
- [x] 6.3 PWA updates (map tiles StaleWhileRevalidate) — 2026-02-15
- [x] 6.4 E2E tests (15 tests across 6 describe blocks) — 2026-02-15
- [x] 6.5 Documentation updates (AGENTS.md, ITERATION_LOG.md, LESSONS_LEARNED.md) — 2026-02-15

## Phase 7: Map Usability — Dynamic Stations + Theme Fix
- [x] 7.1 Add `findStationsInBounds` to geo.ts + tests — 2026-02-15
- [x] 7.2 Fix theme tile switching bug in MapView — 2026-02-15
- [x] 7.3 Refactor MapView: marker cache, moveend handler, debounce — 2026-02-15
- [x] 7.4 Simplify +page.svelte data flow — 2026-02-15
- [x] 7.5 Update documentation (codemap, architecture, iteration log) — 2026-02-15
