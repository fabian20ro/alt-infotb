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

Automated verification:

- `npm ci` with the existing lockfile; no dependency edits.
- App typecheck: zero errors/warnings; catalog and service-worker typechecks pass.
- 32 unit suites / 1,195 tests pass, including 86 new manifest/scene/controller cases.
- Map E2E: 31 pass, 5 intentional device-capability skips; Desktop Chrome, Mobile Chrome, Mobile Safari, one worker.
- Built PWA/cache E2E: 20 pass; missing-key build: 2 pass. These exercise the real service worker and lazy renderer assets under `/alt-infotb/`.
- Independent standards/spec review found a synchronous camera-idle reentrancy issue. A failing regression test reproduced it; reserving initial framing before invoking the renderer fixed it. No outstanding code findings.

Physical Pixel 6a / Chrome 156, local built app at `localhost:4175/alt-infotb/`:

- Real public line-66 geometry from stops 3684 (forward) and 3675 (return), replayed from captured protobuf; both paths visible, 36/36 selected-line stations at overview.
- First selected marker visible 500 ms after navigation; both routes visible 127 ms after row click. These are one-run local/USB observations, not internet or sustained rendering benchmarks.
- Native CDP touch drag moved the selected marker by 99.99 CSS pixels; no JavaScript page errors.
- No live vehicles were present in the real capture; synthetic browser tests separately exercise both vehicle marker sets.
- Local CARTO probe returned HTTP 403 without CORS headers; the identical tile/key with the approved production origin returned HTTP 200 PNG with CORS. This confirms origin restrictions, not a renderer regression. No key restrictions were changed; local preview correctly retained stations/routes and offered fallback. Production code and deployment were not changed.

Coverage/zoom comparison:

- All 3,911 current catalog markers and both captured line-66 paths fit inside the prototype rectangle. This describes this snapshot, not a promise that all future regional services fit.
- Existing raster viewer supports zoom 19; PMTiles contains native zoom 0–15 and permits overzoom to 19. Zooming past 15 enlarges existing geometry rather than adding a new data level.
- At the same Bucur Obor station coordinates on the physical Pixel, the installed offline prototype rendered z15 (535 features / 21 symbols, idle 729 ms) and z18 (36 features / 14 symbols, idle 886 ms), zero map errors, persistence still granted. Screenshots visually show streets, paths and stop labels at z18. Its source server remained stopped.
- The local CARTO origin restriction prevents a side-by-side raster/cartographic quality claim from this preview. Broader visual quality comparison on an authorized preview origin remains a step-4 rollout gate; no renderer switch is approved by these measurements.

Raw local screenshots/JSON are retained outside Git in `/private/tmp/pmtiles-step1-artifacts/`.
Public route payloads and provenance are committed under `src/lib/map/fixtures/`.
Prototype source and package remain separate; no PMTiles renderer/storage is activated here.
