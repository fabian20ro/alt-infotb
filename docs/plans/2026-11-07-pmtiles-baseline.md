# PMTiles and map integration baseline — 2026-11-07

## Isolated prototype evidence

Recorded before integration on local branch `codex/pmtiles-offline-prototype`,
commits `f18f52d`, `093a7c2`, `f54a9ba`. The standalone prototype and its generated
artifacts are intentionally outside this integration PR. This is a summary of its
`prototypes/pmtiles-offline/results-report.md`, not a new production measurement.

- Protomaps 2026-11-06, schema 4.15.2; bbox `[25.80,44.19,26.49,44.80]`, native z0–15, viewer overzoom to z19.
- Archive: 28,789,758 bytes. Full fonts/sprites/licenses: 17,822,582 bytes. Shell: 1,944,915 bytes. Combined payload: 48,557,255 bytes.
- Pixel 6a / Android 17 / Chrome 156: 42/42 offline locality/theme/zoom cases, cold restart with source server stopped, real touch pan/pinch.
- Cold map idle 542 ms; subsequent camera idle 332–727 ms; controlled pan frame interval p95 16.80 ms. This is a short USB-assisted benchmark, not a sustained-load/internet-speed estimate.
- Browser storage 50–54 MB. PWA installation alone still reported `persisted() === false`; normal persistence request afterward returned true, retained across cold offline restart.
- Persistence evidence applies only to that browser/device/origin (`localhost:4174`). Chrome and Brave on the application origin still need separate verification during integration.
- Discovered integration hazards: bundled MapLibre worker, canonical `@2x` paths, complete glyphs/sprites and missing `townhall` sprite. New package validation must cover actual contents, not only descriptors.

## Step 1 verification

Pending final verification results on the integration branch. No PMTiles source is
activated by this step; native z15 street-level visual comparison against the
existing raster source remains an acceptance gate for the MapLibre adapter (step 4).
