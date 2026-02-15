# Codemap

## Directory structure

```
src/
├── app.css                         Global CSS variables and reset
├── app.d.ts                        SvelteKit type declarations + ImportMetaEnv
├── lib/
│   ├── api/
│   │   ├── proto.ts                Protobuf wire-format reader
│   │   ├── proto.test.ts           Tests for protobuf decoding
│   │   ├── client.ts               HTTP fetch wrapper (binary)
│   │   ├── client.test.ts          Tests for HTTP client
│   │   ├── arrivals.ts             Decode + filter stop response
│   │   ├── arrivals.test.ts        Tests for arrival decoding
│   │   ├── constants.ts            API config, auth, stop ID, line colors
│   │   ├── stb-api.integration.test.ts  Real API integration tests (network)
│   │   └── types.ts                TypeScript interfaces
│   ├── components/
│   │   ├── ArrivalBoard.svelte     Main board (header, list, footer)
│   │   ├── ArrivalRow.svelte       Single line row (badge, direction, times)
│   │   ├── LastUpdated.svelte      "actualizat: HH:MM" footer text
│   │   └── RefreshButton.svelte    Refresh icon + auto-refresh toggle
│   ├── stores/
│   │   ├── arrivals.ts             Svelte 5 runes store + formatters
│   │   └── arrivals.test.ts        Tests for format helpers
│   └── index.ts                    Barrel (empty)
├── routes/
│   ├── +layout.svelte              Root layout (imports app.css)
│   ├── +layout.ts                  prerender=true, ssr=false
│   └── +page.svelte                Renders <ArrivalBoard />

e2e/
└── arrival-board.spec.ts           Playwright E2E tests (Desktop + Mobile Chrome)

worker/
├── src/
│   └── index.ts                    Cloudflare Worker proxy (production)
├── package.json                    Worker dependencies (wrangler)
├── tsconfig.json                   Worker TypeScript config
└── wrangler.toml                   Cloudflare Worker configuration
```

## Module dependency graph

```
+page.svelte
  └─ ArrivalBoard.svelte
       ├─ ArrivalRow.svelte ─── constants (LINE_COLORS)
       │                     └── stores/arrivals (formatArrivalTime)
       ├─ RefreshButton.svelte
       ├─ LastUpdated.svelte ─── stores/arrivals (formatTime)
       └─ stores/arrivals ─── api/arrivals
                                  ├── api/client (apiFetchBinary)
                                  ├── api/proto (ProtoReader, helpers)
                                  └── api/constants (API, STOP_ID, ...)

Proxy chain (not in browser bundle):
  vite.config.ts (stbProxy plugin)
    └── api/constants (STB_SERVER_HEADERS, STB_AUTH)

  worker/src/index.ts (standalone, duplicates config values)
```

## Key files

### `src/lib/api/proto.ts`
Minimal protobuf reader. Handles wire types 0 (varint), 1 (fixed64), 2 (length-delimited), 5 (fixed32). Provides `ProtoReader` class and helper functions (`getString`, `getVarint`, `getMessages`, `getVarints`).

### `src/lib/api/arrivals.ts`
Entry point for data fetching. Calls the STB API (via proxy), feeds the binary response through `ProtoReader`, extracts station name/address and per-line arrival data, filters to configured tram lines, sorts by display order.

### `src/lib/api/constants.ts`
All configuration in one place: stop ID (3570), tram line set, line colors, API base URL (environment-aware), STB server headers, auth config (`STB_AUTH`), protobuf field number mapping, refresh interval.

### `src/lib/stores/arrivals.ts`
Reactive store built with Svelte 5 `$state` runes. Manages loading/success/error states, auto-refresh timer, localStorage caching. Also exports pure formatting functions (`formatArrivalTime`, `formatTime`).

### `src/lib/components/ArrivalBoard.svelte`
Top-level component. Creates the store, shows cached data on mount, fetches fresh data, renders `ArrivalRow` for each line. Handles error state with retry button.

### `vite.config.ts`
Vite configuration with `stbProxy` plugin that proxies `/stb-api/*` to `info.stb.ro` with injected headers and auth token management.

### `worker/src/index.ts`
Cloudflare Worker for production. Proxies requests to STB API with headers, manages auth tokens, enforces path whitelist, returns CORS headers.

## Configuration

All tunable values live in `src/lib/api/constants.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `STOP_ID` | `3570` | STB stop ID for Piata Unirii |
| `TRAM_LINES` | `Set(['7','27','47'])` | Which lines to show |
| `LINE_COLORS` | red/blue/teal | Per-line badge colors |
| `LINE_ORDER` | `['7','27','47']` | Display sort order |
| `API.BASE` | env-aware | Proxy URL (dev: `/stb-api`, prod: from env var) |
| `API.TIMEOUT` | `10000` | Request timeout (ms) |
| `STB_AUTH` | App-Id, App-key, path | Auth endpoint config |
| `STB_SERVER_HEADERS` | 7 headers | Headers injected by proxy |
| `AUTO_REFRESH_INTERVAL` | `30000` | Auto-refresh period (ms) |

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_STB_API_BASE` | `.env.production` | Cloudflare Worker URL for production builds |

## Test structure

| Script | What it runs | Network? |
|---|---|---|
| `npm test` | Unit tests (vitest) | No |
| `npm run test:integration` | Real STB API calls (vitest) | Yes |
| `npm run test:e2e` | Playwright browser tests | Yes (via proxy) |
