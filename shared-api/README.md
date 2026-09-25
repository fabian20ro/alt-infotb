# Alt InfoTB shared API module

Provider-neutral STB proxy implementing the
[shared-api-contract v2.0.0](https://github.com/fabian20ro/shared-api-contract/releases/tag/v2.0.0).

The module exports `createHandler(config, dependencies)`. Both the production
Worker and the Vite development bridge use this handler. It accepts `GET` for:

- `/lines/stop`: optional positive `stop_id` / `selected_line_id`, `direction=0|1`;
- `/lines`: line registry;
- `/lines/:lineId`: complete line detail;
- `/lines/:lineId/direction/:direction`: direction `0` or `1`.

All routes accept optional `lang=ro|en`. IDs must be positive safe integers.
Unknown paths return 404; unknown, invalid or duplicate query parameters return
400 before authentication. `OPTIONS` supplies CORS preflight responses.
The colon names in the manifest describe parameters; actual route validation
lives in the handler and does not depend on host routing semantics.

The handler caches the STB user token, coalesces concurrent authentication and
412 refreshes, retries each rejected request once, and preserves upstream
statuses and protobuf bytes. A late 412 cannot invalidate an already refreshed
token. No credentials or auth tokens are returned in diagnostics.

The Vite adapter initializes on first use. Missing credentials return 503 from
the proxy without preventing the app or mocked browser tests from starting.

```sh
npm ci
npm test
npm run check
npm run build
```

Production configuration and provider deployments belong to the private
`shared-api-host` control plane.
