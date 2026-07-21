# Architecture

Better STB is a mobile-first PWA that shows real-time transit arrival times for any station in Bucharest. It features a map-priority split layout with GPS-based station discovery, favorites, and theme/language toggles. The browser app is static (no backend), but requires a **server-side proxy** to reach the STB API.

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
| Development | Vite plugin (`stbProxy` in `vite.config.ts`) | `/stb-api/*` |
| Production | Cloudflare Worker (`worker/src/index.ts`) | Configured via `VITE_STB_API_BASE` env var |

Both proxies handle the same auth flow:
1. Fetch a `User-Info` bcrypt token from `/proxy/user/auth`
2. Cache the token in memory
3. Inject all required headers into every request
4. Retry with a fresh token on 412 (token expired)

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
- **Versioned station catalog from GTFS** — Coordinates, TPBI feed version, and the source update date are bundled by `scripts/fetch-stations.ts`. Both current numeric stop IDs and legacy `1008-{stb_id}` IDs map to the STB API. The PWA already precaches the catalog, so no duplicate IndexedDB cache is used.
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
  string vehicle_type = 3;            // "TRAM", "BUS", "TROLLEYBUS", "SUBWAY"
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

GTFS metro parent station IDs (14xxx, 15xxx, 57xxx) do NOT return data from the STB API. The API uses internal stop IDs (95xx–97xx) for subway stations. Each physical metro station has 2+ API stops (one per platform/direction). Interchange stations have 4+ stops.

The mapping is stored in `src/lib/stations/subway-stops.ts` and was discovered via `scripts/discover-subway-stops.ts` (brute-force scanning range 9500–9757).

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

## Station data flow

```
Every app load:
  1. Load the versioned stations.json bundled and precached by the PWA
  2. Display its stations on the map
  3. Show the catalog's TPBI feed version and source update date

Scheduled catalog update:
  1. GitHub Actions downloads the regional TPBI GTFS feed daily after 4 AM Romanian time
  2. Regenerate and validate the catalog
  3. Skip unchanged feeds; otherwise test, build, commit the catalog, and deploy that artifact

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
