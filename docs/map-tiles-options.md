# Map watermark options — 2026-09-24

The app requests CARTO tiles without a key. CARTO now intentionally serves those requests with an “API key required” watermark. Running the app locally does not make its remote tile service local. This is a provider authentication change, so this PR leaves the tile configuration unchanged.

Options:

| Approach | Fit and tradeoff |
| --- | --- |
| One CARTO key for the deployed application | Smallest change for the shared PWA; users need no setup. Configure website restrictions and monitor aggregate usage. A key embedded in browser requests is visible to users. |
| Each local installation supplies its own CARTO key | Fits independent localhost deployments. Add a local setting or build-time configuration; requires user onboarding. |
| OpenStreetMap standard tiles | No key, but different visual style and no equivalent native dark basemap. Public tile policy prohibits offline area downloads and requires compliant caching. |
| A București–Ilfov PMTiles archive | Most independent option: host the archive yourself or serve it locally. Requires map-renderer integration, data updates, storage, and attribution. |

CARTO currently offers free keys with a fair-use allowance of five million tile requests per month. Website restrictions are optional. For the shared PWA, start with the application key; for genuine local/offline independence, investigate a regional PMTiles archive. CARTO is retiring raster basemaps, so a long-term migration should consider vector rendering.

Sources: [CARTO key guidance](https://www.carto.com/basemaps/apikey/), [CARTO raster notice](https://github.com/CartoDB/basemap-styles), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), [PMTiles concepts](https://docs.protomaps.com/pmtiles/).
