# Codemap

## Directory structure

```
src/
├── app.css                         Global CSS variables and reset
├── app.d.ts                        SvelteKit type declarations
├── lib/
│   ├── api/
│   │   ├── proto.ts                Protobuf wire-format reader
│   │   ├── proto.test.ts           Tests for protobuf decoding
│   │   ├── client.ts               HTTP fetch wrapper (binary)
│   │   ├── client.test.ts          Tests for HTTP client
│   │   ├── arrivals.ts             Decode + filter stop response
│   │   ├── arrivals.test.ts        Tests for arrival decoding
│   │   ├── constants.ts            API config, stop ID, line colors
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
```

## Key files

### `src/lib/api/proto.ts`
Minimal protobuf reader. Handles wire types 0 (varint), 1 (fixed64), 2 (length-delimited), 5 (fixed32). Provides `ProtoReader` class and helper functions (`getString`, `getVarint`, `getMessages`, `getVarints`).

### `src/lib/api/arrivals.ts`
Entry point for data fetching. Calls the STB API, feeds the binary response through `ProtoReader`, extracts station name/address and per-line arrival data, filters to configured tram lines, sorts by display order.

### `src/lib/api/constants.ts`
All configuration in one place: stop ID (3570), tram line set, line colors, API base URL, request headers, protobuf field number mapping, refresh interval.

### `src/lib/stores/arrivals.ts`
Reactive store built with Svelte 5 `$state` runes. Manages loading/success/error states, auto-refresh timer, localStorage caching. Also exports pure formatting functions (`formatArrivalTime`, `formatTime`).

### `src/lib/components/ArrivalBoard.svelte`
Top-level component. Creates the store, shows cached data on mount, fetches fresh data, renders `ArrivalRow` for each line. Handles error state with retry button.

## Configuration

All tunable values live in `src/lib/api/constants.ts`:

| Constant | Value | Purpose |
|---|---|---|
| `STOP_ID` | `3570` | STB stop ID for Piata Unirii |
| `TRAM_LINES` | `Set(['7','27','47'])` | Which lines to show |
| `LINE_COLORS` | red/blue/teal | Per-line badge colors |
| `LINE_ORDER` | `['7','27','47']` | Display sort order |
| `API.BASE` | `info.stb.ro/api/web/v2-6` | STB API base URL |
| `API.TIMEOUT` | `10000` | Request timeout (ms) |
| `AUTO_REFRESH_INTERVAL` | `30000` | Auto-refresh period (ms) |
