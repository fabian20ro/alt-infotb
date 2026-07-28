# Alt STB shared API module

Provider-neutral STB proxy implementing the
[shared-api-contract v2.0.0](https://github.com/fabian20ro/shared-api-contract/releases/tag/v2.0.0).

The module exports `createHandler(config, dependencies)`. It accepts only
`GET`/`OPTIONS /lines/stop`, obtains and caches the STB user token, retries once
after a 412, and passes protobuf bytes through unchanged.

```sh
npm ci
npm test
npm run check
npm run build
```

Production configuration and provider deployments belong to the private
`shared-api-host` control plane.
