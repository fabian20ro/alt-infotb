# STB API Reference

## Endpoint

```
GET https://info.stb.ro/api/web/v2-6/lines/stop?stop_id={stop_id}
```

## Required headers

| Header | Value |
|---|---|
| `App-Id` | `b32cc233-00d7-4640-bf90-374572668c30` |
| `App-Version` | `0.0.0` |
| `Device-Name` | `Chrome` |
| `Lang` | `ro` |
| `OS-Type` | `Web` |
| `OS-Version` | `web` |
| `Source` | `ro.radcom.smartcity.web` |

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
- CORS behavior from different origins has not been confirmed. If blocked, a proxy or browser extension may be needed during development.
