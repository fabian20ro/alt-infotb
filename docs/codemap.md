# Codemap

## Directory structure

```
src/
├── app.css                         Global CSS variables (dark + light themes)
├── app.d.ts                        SvelteKit type declarations + ImportMetaEnv
├── app.html                        HTML shell with viewport meta
├── lib/
│   ├── api/
│   │   ├── proto.ts                Protobuf wire-format reader
│   │   ├── proto.test.ts           Tests for protobuf decoding
│   │   ├── client.ts               HTTP fetch wrapper (binary)
│   │   ├── client.test.ts          Tests for HTTP client
│   │   ├── arrivals.ts             Decode stop response, extract field 9 arrivals
│   │   ├── arrivals.test.ts        Tests for arrival decoding
│   │   ├── constants.ts            API config, auth, proto field numbers
│   │   ├── stb-api.integration.test.ts  Real API integration tests (network)
│   │   └── types.ts                TypeScript interfaces
│   ├── components/
│   │   ├── ArrivalBoard.svelte     Legacy board (kept for reference)
│   │   ├── ArrivalRow.svelte       Single line row (badge, direction, times)
│   │   ├── DrawerMenu.svelte       Hamburger drawer (favorites, recents, settings)
│   │   ├── LastUpdated.svelte      "actualizat: HH:MM" footer text
│   │   ├── MapView.svelte          Leaflet map (viewport-based filtering, marker cache, debounce)
│   │   ├── RefreshButton.svelte    Refresh icon + auto-refresh toggle
│   │   ├── StationArrivals.svelte  Scrollable arrival list for selected station
│   │   ├── StationHeader.svelte    Burger menu + station name + favorite button
│   │   └── map/
│   │       ├── station-icons.ts    Station marker icons by transport type
│   │       ├── tiles.ts            Tile URL configs (light + dark)
│   │       └── user-marker.ts      Blue dot for user GPS location
│   ├── i18n/
│   │   ├── translations.ts        RO + EN translation strings
│   │   └── index.ts                t() translation function
│   ├── stations/
│   │   ├── types.ts                Station, StationWithDistance interfaces
│   │   ├── stations.json           Bundled station data (2710 stops, from GTFS)
│   │   ├── subway-stops.ts         GTFS metro ID → STB API subway stop IDs mapping
│   │   ├── data.ts                 Station loader (IndexedDB → bundled fallback)
│   │   ├── db.ts                   IndexedDB wrapper for station storage
│   │   ├── format.ts               formatLastUpdate() — locale-aware timestamp formatting
│   │   ├── format.test.ts          Tests for format utilities
│   │   ├── geo.ts                  Haversine distance, nearest stations, viewport bounds filter
│   │   ├── geo.test.ts             Tests for geo utilities
│   │   ├── search.ts              Fuzzy search with diacritics stripping
│   │   └── search.test.ts         Tests for station search
│   ├── stores/
│   │   ├── arrivals.svelte.ts      Arrivals store + time formatters
│   │   ├── arrivals.test.ts        Tests for format helpers
│   │   ├── favorites.svelte.ts     Favorite stations (localStorage)
│   │   ├── favorites.test.ts       Tests for favorites store
│   │   ├── geolocation.svelte.ts   GPS position tracking
│   │   ├── recents.svelte.ts       Recent stations (max 5, FIFO)
│   │   ├── recents.test.ts         Tests for recents store
│   │   └── settings.svelte.ts      Theme + language preferences
│   └── index.ts                    Barrel (empty)
├── routes/
│   ├── +layout.svelte              Root layout (imports app.css)
│   ├── +layout.ts                  prerender=true, ssr=false
│   └── +page.svelte                Main page: split layout, map, drawer

scripts/
├── dump-proto.ts                   Diagnostic: dump all protobuf fields from API
├── discover-subway-stops.ts        Scan STB API for subway stop IDs (brute-force)
└── fetch-stations.ts               Extract stations from GTFS stops.txt

e2e/
└── arrival-board.spec.ts           Playwright E2E tests

worker/                              Cloudflare Worker (auto-deploys on push)
├── src/
│   └── index.ts                    Proxy: injects headers + auth token
├── package.json                    Worker dependencies (wrangler)
├── tsconfig.json                   Worker TypeScript config
└── wrangler.toml                   Worker name, entry point, compat date

docs/
├── api.md                          STB API reference, auth flow, curl examples
├── architecture.md                 Data flow, design decisions, protobuf schema
├── codemap.md                      This file
├── deployment.md                   How both components auto-deploy
└── proto-analysis.md               Protobuf field analysis with evidence
```

## Module dependency graph

```
+page.svelte
  ├─ StationHeader.svelte
  ├─ StationArrivals.svelte
  │    └─ ArrivalRow.svelte ─── stores/arrivals (formatArrivalTime)
  ├─ MapView.svelte
  │    ├─ stations/geo.ts (findStationsInBounds — viewport filtering)
  │    ├─ map/station-icons.ts
  │    ├─ map/user-marker.ts
  │    └─ map/tiles.ts
  ├─ DrawerMenu.svelte
  │    └─ stations/format.ts (formatLastUpdate)
  ├─ stores/arrivals ─── api/arrivals
  │   │                    ├── api/client (apiFetchBinary)
  │   │                    ├── api/proto (ProtoReader, helpers)
  │   │                    └── api/constants (API, PROTO_FIELDS)
  │   └─ stations/subway-stops (resolveStopIds)
  ├─ stores/geolocation
  ├─ stores/settings
  ├─ stores/favorites
  ├─ stores/recents
  └─ stations/
       ├── data.ts ─── db.ts (IndexedDB)
       │            └── stations.json (bundled)
       ├── geo.ts
       └── search.ts

Proxy chain (not in browser bundle):
  vite.config.ts (stbProxy plugin)
    └── api/constants (createStbServerHeaders, STB_AUTH_PATH)
    └── .env (STB_APP_ID, STB_APP_KEY — not committed)

  worker/src/index.ts (uses Cloudflare secrets: STB_APP_ID, STB_APP_KEY)
```

## Configuration

All tunable values live in `src/lib/api/constants.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `STOP_ID` | `3570` | Default STB stop ID (Piata Unirii) |
| `API.BASE` | env-aware | Proxy URL (dev: `/stb-api`, prod: from env var) |
| `API.TIMEOUT` | `10000` | Request timeout (ms) |
| `STB_AUTH_PATH` | `/proxy/user/auth` | Auth endpoint path |
| `createStbServerHeaders()` | function(appId) → headers | Headers injected by proxy (credentials from env) |
| `AUTO_REFRESH_INTERVAL` | `30000` | Auto-refresh period (ms) |
| `PROTO_FIELDS` | Field numbers | Protobuf schema mapping |

## Test structure

| Script | What it runs | Tests | Network? |
|---|---|---|---|
| `npm test` | Unit tests (vitest) | 78 | No |
| `npm run test:integration` | Real STB API calls (vitest) | 6 | Yes |
| `npm run test:e2e` | Playwright browser tests | varies | Yes (via proxy) |
