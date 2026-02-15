# Architecture

Better STB is a static single-page app that shows real-time tram arrival times for Piata Unirii in Bucharest. The browser app is static (no backend), but requires a **server-side proxy** to reach the STB API.

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
   ├── filter & sort (arrivals.ts)
   ├── render (Svelte components)
   └── cache (localStorage)
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

1. The app calls the proxy at `/stb-api/lines/stop?stop_id=3570` (dev) or the worker URL (prod)
2. The proxy forwards the request to `info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570` with injected headers
3. The response is **Protocol Buffers** binary (not JSON)
4. A minimal protobuf reader (`proto.ts`) decodes the wire format
5. `arrivals.ts` maps the decoded fields to `ArrivalInfo[]` and filters to lines 7, 27, 47
6. The Svelte store pushes data to components for rendering
7. Results are cached in localStorage for offline display

## Key design decisions

- **No protobuf library** — The response schema is small and stable. A ~100-line reader handles varint and length-delimited wire types, which is all we need. This keeps the bundle tiny.
- **Proxy required** — The STB API requires custom headers (`User-Info`, `App-Id`, etc.) that CORS blocks from browsers. A server-side proxy injects them. Vite handles dev, Cloudflare Worker handles prod.
- **Static adapter** — SvelteKit prerenders a single HTML shell. All logic runs client-side (`ssr = false`).
- **PWA** — The app is installable via `vite-plugin-pwa`. The service worker caches static assets; API calls use `NetworkOnly` since stale arrival times are worse than no data.

## Protobuf schema (reverse-engineered)

```
message StopResponse {
  string name = 1;            // "Piata Unirii"
  string address = 2;         // "Bd. Regina Maria, Bucuresti"
  string type = 5;            // "STATION"
  repeated LineEntry lines = 10;
}

message LineEntry {
  string name = 1;            // "27"
  int32  id = 2;              // 66
  string vehicle_type = 3;    // "TRAM"
  string color = 4;           // "#BE1622"
  string direction = 5;       // "Faur"
  int32  arrival_time_1 = 6;  // seconds
  int32  arrival_time_2 = 7;  // seconds
  int32  arrival_time_3 = 8;  // seconds
}
```

Field numbers were determined by inspecting the raw binary response with `hexdump`.
