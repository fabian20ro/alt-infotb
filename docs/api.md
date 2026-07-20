# STB API Reference

## Endpoint

```
GET https://info.stb.ro/api/web/v2-6/lines/stop?stop_id={stop_id}
GET https://info.stb.ro/api/web/v2-6/lines/stop?stop_id={stop_id}&selected_line_id={line_id}&direction={0|1}
```

## Authentication

The API requires a `User-Info` header containing a bcrypt hash token. Without it, the server returns **400 Bad Request** with: `Missing request header 'User-Info'`.

### Auth endpoint

```
GET https://info.stb.ro/api/web/v2-6/proxy/user/auth
```

Headers:
| Header | Value |
|---|---|
| `App-key` | `$STB_APP_KEY` (from environment) |
| `App-Id` | `$STB_APP_ID` (from environment) |

Response (JSON):
```json
{ "data": { "userInfo": "$2a$10$..." } }
```

The `userInfo` value is used as the `User-Info` header on subsequent API calls. When the token expires, the API returns **412 Precondition Failed**, signaling the client to re-authenticate.

## Required Headers

All requests to the stop endpoint require these headers:

| Header | Value | Required |
|---|---|---|
| `App-Id` | `$STB_APP_ID` (from environment) | Yes |
| `App-Version` | `0.0.0` | Yes |
| `Device-Name` | `Chrome` | Yes |
| `Lang` | `ro` | Yes |
| `OS-Type` | `Web` | Yes |
| `OS-Version` | `web` | Yes |
| `Source` | `ro.radcom.smartcity.web` | Yes |
| `User-Info` | bcrypt hash from auth endpoint | Yes |

**CORS limitation:** These headers trigger a CORS preflight (OPTIONS) request that the STB server rejects (`Access-Control-Allow-Headers` only allows `Content-Type, Authorization, X-Requested-With`). Browsers cannot send these headers cross-origin. A **server-side proxy** is required.

## Proxy Architecture

The browser never talks to the STB API directly. Instead:

```
Browser ──GET──▸ Proxy ──GET + headers──▸ info.stb.ro
         (no custom       (injects App-Id,
          headers)         User-Info, etc.)
```

- **Development**: Vite plugin (`stbProxy` in `vite.config.ts`) handles proxying at `/stb-api/*`
- **Production**: Cloudflare Worker (`worker/src/index.ts`) proxies requests with headers

Both proxies:
1. Fetch an auth token on first request (lazy initialization)
2. Cache the token in memory
3. Retry once on 412 (token expired) with a fresh token

## Response format

The response body is **Protocol Buffers** binary, not JSON. A selected-line response still includes all station arrivals and adds the selected route polyline plus live vehicle positions. While a line is selected, the app requests both `direction=0` and `direction=1` on the existing 20-second polling cycle; the tapped direction's response also replaces the ordinary arrivals refresh. The reverse payload is only available from a stop served in that direction, so the app discovers and caches a suitable stop near the route's opposite terminus when the tapped platform cannot provide it. See [architecture.md](./architecture.md) for the decoded schema.

## Known stop IDs

| Stop ID | Name | Address | Type |
|---|---|---|---|
| `3570` | Piata Unirii | Bd. Regina Maria, Bucuresti | Surface (tram) |
| `9543` | Piata Unirii | Piata Unirii | Subway (M2→Pipera) |
| `9544` | Piata Unirii | Piata Unirii | Subway (M2→Tudor Arghezi) |
| `9552` | Piata Unirii | Piata Unirii | Subway (M1→Dristor, M3→Preciziei) |
| `9553` | Piata Unirii | Piata Unirii | Subway (M3→A.Saligny, M1→Pantelimon) |

**Note:** GTFS metro parent station IDs (14xxx, 15xxx, 57xxx) do NOT return data from the STB API. The API uses its own internal stop IDs (95xx–97xx) for subway stations. See `src/lib/stations/subway-stops.ts` for the full mapping. Discovered via `scripts/discover-subway-stops.ts`.

## Known line IDs

| Line name | Line ID (protobuf field 2) | Type |
|---|---|---|
| 7 | 69 | TRAM |
| 27 | 66 | TRAM |
| 32 | 70 | TRAM |
| 47 | 61 | TRAM |

## Example (curl)

### Step 1: Get auth token

```bash
# Requires STB_APP_ID and STB_APP_KEY environment variables (see .env.example)
TOKEN=$(curl -s 'https://info.stb.ro/api/web/v2-6/proxy/user/auth' \
  -H "App-key: $STB_APP_KEY" \
  -H "App-Id: $STB_APP_ID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['userInfo'])")
```

### Step 2: Fetch stop data

```bash
curl -s 'https://info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570' \
  -H "App-Id: $STB_APP_ID" \
  -H 'App-Version: 0.0.0' \
  -H 'Device-Name: Chrome' \
  -H 'Lang: ro' \
  -H 'OS-Type: Web' \
  -H 'OS-Version: web' \
  -H 'Source: ro.radcom.smartcity.web' \
  -H "User-Info: $TOKEN" \
  | hexdump -C | head -10
```

## Notes

- The `User-Info` header is **required** as of 2026-02-15. Without it the API returns 400.
- The domain is `info.stb.ro` (not `info.stbsa.ro` which was a previous version).
- CORS: The STB server responds to preflight requests but rejects custom headers. A proxy is mandatory for browser access.
