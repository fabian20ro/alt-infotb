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
│   │   ├── arrivals.ts             Decode arrivals, selected route, live vehicles
│   │   ├── arrivals.test.ts        Tests for arrival decoding
│   │   ├── topology.ts             Strict registry, line topology and stop-evidence decoders
│   │   ├── topology.test.ts        Actual protobuf contract and malformed-input tests
│   │   ├── transport.ts            Canonical types; CABLE_CAR → TROLLEYBUS alias
│   │   ├── fixtures/topology/      Captured binary responses, hashes and provenance
│   │   ├── constants.ts            API config, auth, proto field numbers
│   │   ├── stb-api.integration.test.ts  Real API integration tests (network)
│   │   └── types.ts                TypeScript interfaces
│   ├── components/
│   │   ├── ArrivalRow.svelte       Selectable line row (badge, direction, times)
│   │   ├── DrawerMenu.svelte       Hamburger drawer (favorites, recents, settings)
│   │   ├── LastUpdated.svelte      "actualizat: HH:MM" footer text
│   │   ├── MapView.svelte          Leaflet stations, route paths, keyed live vehicles
│   │   ├── RouteStatus.svelte      Selected route direction, count, overview, close
│   │   ├── StationArrivals.svelte  Scrollable/selectable arrivals, retry, loading bar
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
│   │   ├── stations.json           Composed STB/GTFS catalog, line IDs and source metadata
│   │   ├── subway-stops.ts         Physical metro marker → API platforms, including M5
│   │   ├── data.ts                 Catalog loader, source metadata, exact line membership
│   │   ├── membership.ts           Pure authoritative matching and coordinate validation
│   │   ├── data.test.ts            Catalog invariants and membership regression
│   │   ├── format.ts               formatCatalogDate() — source-date formatting
│   │   ├── format.test.ts          Tests for format utilities
│   │   ├── geo.ts                  Haversine distance, nearest stations, viewport bounds filter
│   │   ├── geo.test.ts             Tests for geo utilities
│   │   ├── search.ts              Fuzzy search with diacritics, punctuation, dash, and whitespace normalization
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
├── station-catalog.ts              Parse TPBI stops and scheduled fallback membership
├── fetch-stations.ts               Generate fresh GTFS fallback input
├── catalog-cli.ts                 CLI options and remote/in-process shared-proxy transport
├── catalog-collection.ts           Serial, resumable registry/topology collection + evidence
├── collect-stb-catalog.ts          Topology collection CLI
├── transit-day.ts                  Europe/Bucharest 04:00 service-day boundary
├── stb-catalog.ts                  Pure STB topology + fresh GTFS composition
├── generate-stb-catalog.ts         Composition CLI
├── station-membership-audit.ts     Full known-stop live audit and Markdown/JSON reporting
├── audit-station-membership.ts     Explicit --live --full audit CLI
├── catalog-publication.ts          Exhaustive runtime comparator + protected publication gate
├── verify-stb-catalog.ts           Verification/publication-check CLI
├── station-membership.test.ts      Every captured line/direction through real map filtering
└── *.test.ts                       Collector, generator, audit and publication failure tests

catalog/
├── gtfs-fallback.json              Independent GTFS generation input
└── stb-topology.json               Independent STB registry, directions, stops and evidence

e2e/
├── arrival-board.spec.ts           General Playwright E2E tests
├── map-touch.spec.ts               Mocked desktop/mobile map interactions
└── route-map.spec.ts               Mocked selected-route desktop/mobile E2E

shared-api/
├── src/index.ts                    Shared path/query validation, auth and binary proxy handler
└── test/contract.test.ts           Proxy allowlist, auth concurrency and response contracts

worker/                              Cloudflare Worker (deployment explicitly gated)
├── src/
│   └── index.ts                    Proxy: injects headers + auth token
├── package.json                    Worker dependencies (wrangler)
├── tsconfig.json                   Worker TypeScript config
└── wrangler.jsonc                  Worker name, entry point, compat date

.github/workflows/
├── deploy.yml                     Offline app checks/build, browser tests and Pages artifact
└── catalog-audit.yml               Daily topology, weekly/full audit, protected data publication

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
  ├─ RouteStatus.svelte
  ├─ DrawerMenu.svelte
│    └─ stations/format.ts (formatCatalogDate)
  ├─ stores/arrivals ─── api/arrivals + stations/geo
  │   │                    ├── api/client (apiFetchBinary)
  │   │                    ├── api/proto (ProtoReader, helpers)
  │   │                    └── api/constants (API, PROTO_FIELDS)
  │   └─ stations/subway-stops (resolveStopIds)
  ├─ stores/geolocation
  ├─ stores/settings
  ├─ stores/favorites
  ├─ stores/recents
  └─ stations/
       ├── data.ts ─── stations.json + membership.ts (versioned PWA bundle)
       ├── geo.ts
       └── search.ts

Proxy chain (not in browser bundle):
  vite.config.ts (stbProxy plugin)
    └── shared-api/src/index.ts (createHandler)
    └── .env (STB_APP_ID, STB_APP_KEY — not committed)

  worker/src/index.ts (uses Cloudflare secrets: STB_APP_ID, STB_APP_KEY)
    └── shared-api/src/index.ts (same createHandler)

Offline catalog pipeline:
  catalog-collection.ts ─── shared proxy + api/topology.ts
    └── catalog/stb-topology.json (independent source snapshot)
  station-catalog.ts ─── TPBI files
    └── catalog/gtfs-fallback.json
  stb-catalog.ts ─── both source inputs + subway-stops.ts
    └── stations.json (composition)
  catalog-publication.ts ─── source snapshot + composition
    └── membership.ts + geo.ts (same loader policy/matcher/map filter as runtime)
  station-membership-audit.ts ─── all known API IDs + shared proxy
    └── exact discrepancies, coverage and source/catalog hash bindings
```

## Configuration

Runtime API constants live in `src/lib/api/constants.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `STOP_ID` | `3570` | Default STB stop ID (Piata Unirii) |
| `API.BASE` | env-aware | Proxy URL (dev: `/stb-api`, prod: from env var) |
| `API.TIMEOUT` | `10000` | Request timeout (ms) |
| `STB_AUTH_PATH` | `/proxy/user/auth` | Auth endpoint path |
| `createStbServerHeaders()` | function(appId) → headers | Headers injected by proxy (credentials from env) |
| `ARRIVALS_REFRESH_INTERVAL` | `20000` | Auto-refresh period (ms) |
| `PROTO_FIELDS` | Field numbers | Protobuf schema mapping |

Catalog collection configuration is separate in `scripts/catalog-cli.ts`: proxy source, cache directory, request spacing, timeout, retry/time budget and checkpoint freshness. Publication requires `STB_CATALOG_PUBLISH_ENABLED`; Worker deployment separately requires `WORKER_DEPLOY_ENABLED`. Neither gate is enabled by this implementation. Production proxy activation and unresolved upstream registry gaps remain rollout dependencies; see [architecture](architecture.md#current-operational-limits-and-next-architectural-step).

## Test structure

| Script | What it runs | Network? |
|---|---|---|
| `npm test` | Unit, captured-source and exhaustive catalog tests | No |
| `npm run test:catalog` | Catalog collection/composition/audit/publication and source regressions | No |
| `npm run stations:verify` | Complete source-to-runtime comparator; optional protected publication check | No |
| `npm run stations:collect` | Independent registry and topology acquisition | Yes, via shared proxy |
| `npm run stations:audit -- --live --full` | Every known catalog/topology API stop | Yes, via shared proxy |
| `npm run test:integration` | Real STB API integration tests | Yes |
| `npm run test:e2e:map` | Mocked Chromium/WebKit map flows, one worker | Mocked API |
| `npm run test:e2e` | General Playwright suite, one worker | May use live proxy |
