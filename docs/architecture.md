# Architecture

Alt InfoTB is a mobile-first PWA for Bucharest and regional transit. It combines a versioned station catalog with live arrivals, GPS-based station discovery, favorites, and theme/language toggles. The browser app is static, but requires a **server-side proxy** to reach the STB API.

## High-level flow

```
Browser ──fetch──▸ Proxy ──fetch + headers──▸ info.stb.ro (protobuf)
   │                 │                              │
   │                 │ injects App-Id, User-Info,   │
   │                 │ Lang, Source, etc.            │
   │                 │                              │
   │                 ◂──── binary protobuf ─────────┘
   │                 │
   ◂── protobuf ─────┘
   │
   ├── decode (proto.ts)
   ├── extract arrivals, selected route, and live vehicles (arrivals.ts)
   ├── render (Svelte components)
   ├── cache arrivals and preferences (localStorage)
   └── display on map (Leaflet)
```

### Proxy layer

The STB API requires custom headers that browsers can't send cross-origin (CORS rejects them). A proxy sits between the browser and the API:

| Environment | Proxy | URL prefix |
|---|---|---|
| Development | Vite bridge → `shared-api/src/index.ts` | `/stb-api/*` |
| Production | Cloudflare Worker → same shared handler | Configured via `VITE_STB_API_BASE` |
| Catalog collection | Configured remote proxy, or same handler in-process with local server configuration | `STB_CATALOG_PROXY` / `--proxy-config` |

The shared handler validates methods, paths, origins and query parameters before authentication. Its read-only allowlist contains `/lines/stop`, `/lines`, `/lines/:id`, and `/lines/:id/direction/:direction`. The auth flow is:
1. Fetch a `User-Info` bcrypt token from `/proxy/user/auth`
2. Cache the token in memory
3. Inject all required headers into every request
4. Retry once on 412 (token expired), coalescing concurrent refreshes and reusing a token already refreshed by another request

Credentials remain server-side. Collection checkpoints retain response bodies, hashes and timestamps; they never retain authorization headers. Missing local credentials do not prevent the app or mocked browser tests from starting.

### Data pipeline

1. The app calls the proxy at `/stb-api/lines/stop?stop_id={id}` (dev) or the worker URL (prod)
2. The proxy forwards the request to `info.stb.ro/api/web/v2-6/lines/stop?stop_id={id}` with injected headers
3. The response is **Protocol Buffers** binary (not JSON)
4. A minimal protobuf reader (`proto.ts`) decodes the wire format
5. `arrivals.ts` extracts field 8 direction, field 9 arrivals, and selected-line fields 11/12
6. The Svelte store pushes data to components for rendering
7. Arrival rows are cached for offline display; live coordinates are deliberately stripped

## Key design decisions

- **No protobuf library** — The response schema is small. The custom reader handles varint, length-delimited, and fixed-size wire types, keeping the bundle small.
- **Proxy required** — The STB API requires custom headers (`User-Info`, `App-Id`, etc.) that CORS blocks from browsers. A server-side proxy injects them. Vite handles dev, Cloudflare Worker handles prod.
- **Static adapter** — SvelteKit prerenders a single HTML shell. All logic runs client-side (`ssr = false`).
- **PWA** — The app is installable via `vite-plugin-pwa`. Static assets are precached; API calls use `NetworkOnly`; map tiles use `StaleWhileRevalidate`.
- **Leaflet lazy-loading** — Leaflet (~43KB gzip) is loaded via dynamic `import()` after initial render, with a loading skeleton shown while the map initializes.
- **Versioned catalog from independent source captures** — Registered STB topology supplies current line IDs, stop identities, coordinates and both directions. A fresh GTFS catalog supplies physical metro markers and explicit fallback services. Source snapshots and generated data are versioned separately, keeping the test oracle independent of its output. No browser-wide network discovery or duplicate IndexedDB cache is added.
- **Stable upstream identities** — Known STB lines match station `lineIds`; names and transport labels cannot invalidate their membership. `CABLE_CAR` normalizes to `TROLLEYBUS` at the API boundary. Unknown types remain diagnostic failures in catalog collection instead of silently becoming buses.
- **Immutable state** — All stores use Svelte 5 `$state` runes. State updates create new values rather than mutating.

## Protobuf schema (verified 2026-02-15, expanded 2026-07-19)

See `docs/proto-analysis.md` for full evidence from `scripts/dump-proto.ts`.

```
message StopResponse {
  string name = 1;                    // "Piata Unirii"
  string address = 2;                 // "Bd. Regina Maria, Bucuresti"
  string type = 5;                    // "STATION"
  repeated LineEntry lines = 10;
}

message LineEntry {
  string name = 1;                    // "27"
  int32  id = 2;                      // 66
  string vehicle_type = 3;            // Raw STB uses "CABLE_CAR" for trolleybuses
  string color = 4;                   // "#BE1622"
  string direction = 5;               // "Faur"
  int32  first_arrival_seconds = 6;   // seconds (redundant with arrivals[0])
  int32  unknown_7 = 7;              // always 0
  int32  direction_id = 8;           // 0 or 1
  repeated ArrivalEntry arrivals = 9; // THE REAL ARRIVAL DATA
  string encoded_path = 11;          // selected-line response only
  repeated Vehicle vehicles = 12;    // selected-line response only
}

message Vehicle {
  int32 id = 1;
  double latitude = 2;
  double longitude = 3;
  string vehicle_type = 4;
  int32 accessible = 5;
}

message ArrivalEntry {
  int32  is_scheduled = 1;           // 0 = real-time GPS, 1 = estimated
  int32  seconds = 2;                // seconds until arrival
}
```

**Important**: Fields 6, 7, 8 were originally misidentified as three separate arrival times. Arrival data lives in field 9; field 8 is the selected-line direction ID.

## UI Architecture

```
+----------------------------------+
| [=] Station Name           [fav] |  <- StationHeader (48px)
|   Address subtitle               |
|----------------------------------|
||  Scrollable arrival rows         |  <- StationArrivals (flex: 1)
||  [Line] Direction    Time Time   |     ArrivalRow per line
||  loading bar                     |
|==================================|
| [Line] Towards ...  live status  |  <- RouteStatus (only after row tap)
|          Leaflet Map             |  <- MapView (50dvh)
| Stations + route + live vehicles |     Viewport-filtered, 100-station cap
+----------------------------------+

Hamburger drawer (left slide):
  - Favorites
  - Recents (excluding favorites)
  - Theme toggle (Light/Dark)
  - Language toggle (RO/EN)
  - Last data update timestamp
  - Build status badge
```

## Subway stop ID resolution

GTFS metro parent station IDs (including 14xxx, 15xxx, 57xxx and 990xx) are separate from API platform identities. STB platform IDs include 95xx–98xx, M5 109xx and Tudor Arghezi 123xx. Each physical metro station has 2+ API stops; interchanges combine multiple platform pairs.

The mapping is stored in `src/lib/stations/subway-stops.ts`. Initial M1–M4 discovery used `scripts/discover-subway-stops.ts`; complete STB topology captured on 2026-09-25 added M5, its Eroilor interchange platforms, and M2 Tudor Arghezi. Existing physical marker IDs are preserved for favorites and recents. Topology proves platform identity; availability of arrivals is checked separately.

When a user taps a metro station on the map:
1. `resolveStopIds(gtfsId)` returns an array of STB API stop IDs
2. `fetchArrivals([id1, id2, ...])` fetches all stops in parallel via `Promise.allSettled`
3. Results are merged: arrivals concatenated, re-sorted by line name
4. Partial failures are tolerated — if one platform fails, others still show

For surface transport (bus, tram, trolleybus), the GTFS ID maps directly to the API stop ID, so `resolveStopIds` returns `[stationId]` unchanged.

## Selected-line map flow

1. Tapping an arrival row selects its exact `sourceStopId`, `lineId`, and field-8 direction.
2. Each regular 20-second refresh starts the tapped direction and its flipped `0|1` direction concurrently.
3. STB only returns selected geometry from a stop served in that direction. If the tapped platform cannot provide the reverse payload, the app finds that line/direction among stops nearest the tapped route's opposite terminus, requests it there, and reuses the discovered stop on later polls.
4. The tapped-direction response updates normal arrivals; both selected responses publish their route geometry and every returned live vehicle as one snapshot.
5. The tapped direction uses a solid route and filled line-color markers. The opposite direction uses a dashed route and hollow yellow markers.
6. Selecting a line and later polls preserve the user's pan/zoom. Only the explicit route-overview control fits the union of both paths.
7. A one-direction failure shows the successful direction only. Stale coordinates are cleared rather than presented as live.

The selected overlay carries the STB `lineId`. `stations/membership.ts` matches it against the bundled authoritative registry and the station's `lineIds`, unioned across both directions. A missing edge for a known ID cannot fall back to stale GTFS membership. Explicitly supplemental services use normalized `VEHICLE_TYPE:lineName` keys. Metro platform memberships roll up through the reviewed platform-to-marker map. No proximity inference or extra API request is needed. Selected-line stations remain visible above the background marker cap.

## Station data flow

```
Every app load:
  1. Load the versioned stations.json bundled with the PWA
  2. Display its stations on the map
  3. Retain separate TPBI source metadata and STB observation provenance

Scheduled catalog candidate:
  1. Enumerate STB registry independently; collect full detail and both directions
  2. Re-read registry, validate consistency, retain source response evidence
  3. Download fresh GTFS fallback; compose a separate candidate catalog
  4. Verify every source edge through runtime loading, matching and map filtering
  5. Cross-check all known API stops weekly/manually and before every publication
  6. Publish only after freshness, coverage, deletion and application checks pass

Station selection:
  1. Tap map marker → selectStation(station)
  2. Update arrivals store with new stop_id
  3. Fetch arrivals from STB API
  4. Add to recents

Map viewport updates:
  1. User pans/zooms → Leaflet fires 'moveend'
  2. Debounced (150ms) → findStationsInBounds(viewport, allStations, 100)
  3. Diff against marker cache (Map<id, L.Marker>)
  4. Add new markers, remove off-screen, update selection icons
  5. Selected station always included regardless of viewport/cap
```

## Catalog pipeline and publication boundaries

`catalog/stb-topology.json` stores the captured registry, direction edges, stops and response hashes. `catalog/gtfs-fallback.json` stores the independently generated GTFS input. `scripts/stb-catalog.ts` composes both into `src/lib/stations/stations.json`; feeding it an earlier composition is rejected to prevent accumulating stale memberships. Surface coordinates and membership come from the same source capture. Runtime coordinate validation accepts valid regional coordinates without an implicit Bucharest clipping rectangle.

`scripts/catalog-collection.ts` collects serially with bounded retries, time budgets, `Retry-After` handling and resumable body/hash checkpoints. Registry changes, unknown types, empty topology and conflicting stop identities make the capture inconclusive. A capture records an observation interval, not an atomic upstream revision. The transit-day calculation uses Europe/Bucharest and its 04:00 boundary.

Deterministic tests traverse every captured line, both directions, and every stop through production membership and the map density filter. Raw protobuf fixtures independently preserve real `CABLE_CAR`, N109/Isovolta and registry-gap cases. `scripts/catalog-publication.ts` adds a standalone exhaustive comparator and rejects extra edges, unresolved platforms, invalid coordinates and altered semantic hashes. These checks run without network access or secrets.

The live audit enumerates the union of catalog and topology API IDs, deduplicating shared metro platforms. Positive stop responses can reveal missing memberships or unregistered services. Empty responses, unknown types and failures remain unverified; absent arrivals never delete an edge. JSON/Markdown reports distinguish conform, nonconform and inconclusive results and retain coverage, exact discrepancies and evidence.

`.github/workflows/catalog-audit.yml` runs daily after 04:00 Romanian time. Sunday/manual runs scan every known API stop; enabling publication requires that full scan on each publication attempt. Audit concurrency is separate from Pages and artifacts survive failed runs for 30 days. `STB_CATALOG_PUBLISH_ENABLED` gates catalog publication; observation history is saved independently. The publication guard requires a conform full audit bound to the exact snapshot and catalog hashes, observations within six hours, a later independent capture confirming deletions, and explicit review for initial or bulk changes.

Candidates pass type checks, unit tests and build; publishing also runs serial map browser tests. A semantic hash suppresses timestamp-only commits. The workflow checks that main has not advanced, commits the validated source/catalog files, then explicitly dispatches `deploy.yml` because `GITHUB_TOKEN` pushes do not trigger another workflow. Deploy rebuilds and tests the committed data and uploads its tested artifact. Normal app PRs/deployments never depend on live catalog acquisition; failed acquisition preserves the committed catalog.

### Current operational limits and next architectural step

The collector, comparator, runtime integration and protected publisher are implemented. Operational activation remains gated: the deployed proxy still needs the new topology allowlist, and upstream contradictions prevent a conform full audit. `WORKER_DEPLOY_ENABLED` remains false; this change does not deploy infrastructure or enable automatic publication.

Observed stop responses contain services absent from the independent registry, including IDs 907/909 and N700 ID 1036. Their probed line-detail endpoints return empty HTTP 200 bodies. Equal display names do not establish identity equivalence; the catalog must not invent aliases. Catalog topology coverage therefore means every **registered, captured** line, not every service known to every STB endpoint.

The separate observed-service inventory and bounded discovery are now implemented: each newly observed line ID gets one deduplicated discovery attempt, a provenance record and an unresolved/resolved status. Its result can expand the inventory only after identity and topology validation. This closes discoverable registry gaps without unioning historical arrival evidence forever. See the current [implementation/follow-up plan](plans/2026-09-25-station-catalog-audit.md) for remaining work and rollout criteria.

### Historical service inventory and bounded discovery

`service-discovery.ts` follows positive stop observations into unregistered service
IDs. Each service is queried once for detail and both directions. Only a complete,
consistent identity and stop union expands the stop frontier; responses from new
stops can reveal another service. Defaults cap traversal at three rounds, 25
services and 250 new stops, in addition to the collector's time budget. Pending
frontiers, empty bodies, conflicts, stale evidence or registry changes remain
inconclusive. Discovery does not add services to the provider's registry or to the
runtime station catalog.

`service-inventory-capture.ts` binds the snapshot, audit and discovery hashes and
normalizes their timestamped observations. `service-inventory.ts` appends validated
captures and rebuilds per-ID summaries: first/last observation, label history,
registry presence, topology quality and latest positively observed stops. Capture
assessment records registry-only versus stop-scan scope, requested coverage and
outcomes. Direction evidence is retained. Reusing cached responses cannot advance
last-seen time. Operational status remains unknown: neither registry absence nor
an empty stop response proves cancellation, and equal labels never merge IDs.

`service-inventory-storage.ts` stores this history on the dedicated
`data/service-inventory` branch, independently of catalog publication. It validates
and restores the previous JSON, rejects truncation/corruption, and writes a single
file through Git objects without changing the working branch or index. Explicit
compare-and-swap leases reject concurrent writers. Failed remote reads never
silently initialize empty history. Failed/inconclusive audits can still append
valid observations before the workflow fails; publication guards remain strict.

History is lossless initially. Future archival must preserve lifecycle transitions
and provenance explicitly; the branch is not a browser data source. Promotion of
verified discovered topology into a future catalog needs its own reviewed schema
and publication policy. See [next implementation plan](plans/2026-09-25-service-inventory-next.md).
