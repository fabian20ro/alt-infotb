# STB API Reference

## Endpoint

```
GET https://info.stb.ro/api/web/v2-6/lines/stop?stop_id={stop_id}
```

## Headers

The STB API accepts these custom headers (observed from the official STB web app):

| Header | Value |
|---|---|
| `App-Id` | `b32cc233-00d7-4640-bf90-374572668c30` |
| `App-Version` | `0.0.0` |
| `Device-Name` | `Chrome` |
| `Lang` | `ro` |
| `OS-Type` | `Web` |
| `OS-Version` | `web` |
| `Source` | `ro.radcom.smartcity.web` |

**CORS note:** These headers are **not sent** from the browser app. They are non-standard headers that trigger a CORS preflight (OPTIONS) request, and the STB server rejects them with `Access-Control-Allow-Headers` that doesn't include them. The API works without these headers from cross-origin pages. They are listed here for reference only (e.g., for curl or server-side use).

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

```bash
curl -s 'https://info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570' \
  -H 'App-Id: b32cc233-00d7-4640-bf90-374572668c30' \
  -H 'App-Version: 0.0.0' \
  -H 'Device-Name: Chrome' \
  -H 'Lang: ro' \
  -H 'OS-Type: Web' \
  -H 'OS-Version: web' \
  -H 'Source: ro.radcom.smartcity.web' \
  | hexdump -C | head -10
```

## Notes

- The API may also require a `User-Info` header (bcrypt hash) for some endpoints. The stop arrival endpoint works without it as of the time of writing.
- The domain is `info.stb.ro` (not `info.stbsa.ro` which was a previous version).
- CORS: The STB server responds to preflight requests but rejects custom headers. The app omits all custom headers to avoid triggering preflight, which allows cross-origin requests to succeed.
