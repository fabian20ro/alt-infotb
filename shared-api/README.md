# Shared API module

Status: migration placeholder. Provider-neutral API code will live in this directory.

Pinned contract: [v1.0.1](https://github.com/fabian20ro/shared-api-contract/releases/tag/v1.0.1)  
Authoring guide: [module-authoring.md](https://raw.githubusercontent.com/fabian20ro/shared-api-contract/v1.0.1/docs/module-authoring.md)  
JSON Schema: [module.schema.json](https://raw.githubusercontent.com/fabian20ro/shared-api-contract/v1.0.1/schema/module.schema.json)  
Schema SHA-256: `7c3ad6d9e7285060e17e3588424b96b501047202de93f809759e8efa830c2301`

Implementation must preserve the STB binary protobuf response contract and follow the public module contract. This repository contains module source, tests, fixtures, and declared configuration names only. Production secrets, provider IDs, source locks, and deployments remain in the private `shared-api-host` control plane.

A public merge does not deploy. Production adoption requires an explicit, reviewed source-lock update in `shared-api-host`.
