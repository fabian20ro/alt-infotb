# Architecture

Better STB is a static single-page app that shows real-time tram arrival times for Piata Unirii in Bucharest. It runs entirely in the browser with no backend.

## High-level flow

```
Browser ──fetch──▸ info.stb.ro (protobuf) ──decode──▸ UI
                                               │
                                          localStorage
                                          (offline cache)
```

1. The app calls the STB public API at `info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570`
2. The response is **Protocol Buffers** binary (not JSON)
3. A minimal protobuf reader (`proto.ts`) decodes the wire format
4. `arrivals.ts` maps the decoded fields to `ArrivalInfo[]` and filters to lines 7, 27, 47
5. The Svelte store pushes data to components for rendering
6. Results are cached in localStorage for offline display

## Key design decisions

- **No protobuf library** — The response schema is small and stable. A ~100-line reader handles varint and length-delimited wire types, which is all we need. This keeps the bundle tiny.
- **No backend / proxy** — All API calls happen from the browser. This means zero hosting cost but depends on CORS being allowed by the STB API.
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
