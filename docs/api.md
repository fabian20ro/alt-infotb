# STB API Reference

## Endpoint

```
GET https://info.stb.ro/api/web/v2-6/lines/stop?stop_id={stop_id}
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
| `App-key` | `gcALgRyZHC,qFonZ=Jde` |
| `App-Id` | `b32cc233-00d7-4640-bf90-374572668c30` |

Response (JSON):
```json
{ "data": { "userInfo": "$2a$10$..." } }
```

The `userInfo` value is used as the `User-Info` header on subsequent API calls. When the token expires, the API returns **412 Precondition Failed**, signaling the client to re-authenticate.

## Required Headers

All requests to the stop endpoint require these headers:

| Header | Value | Required |
|---|---|---|
| `App-Id` | `b32cc233-00d7-4640-bf90-374572668c30` | Yes |
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

The response body is **Protocol Buffers** binary, not JSON. See [architecture.md](./architecture.md) for the decoded schema.

## Known stop IDs

| Stop ID | Name | Address |
|---|---|---|
| `3570` | Piata Unirii | Bd. Regina Maria, Bucuresti |

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
TOKEN=$(curl -s 'https://info.stb.ro/api/web/v2-6/proxy/user/auth' \
  -H 'App-key: gcALgRyZHC,qFonZ=Jde' \
  -H 'App-Id: b32cc233-00d7-4640-bf90-374572668c30' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['userInfo'])")
```

### Step 2: Fetch stop data

```bash
curl -s 'https://info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570' \
  -H 'App-Id: b32cc233-00d7-4640-bf90-374572668c30' \
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
