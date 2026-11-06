# PMTiles integration: step 1 contracts

Status: implementation branch only, 2026-11-07. Leaflet remains the sole renderer.
No deployment, provider change, offline download UI, storage mutation or infrastructure provisioning.
The [accepted plan](plans/2026-11-07-pmtiles-integration.md) covers later steps.

## Map boundary

`MapView.svelte` owns Svelte 5 reactivity, controls, translations and lazy lifecycle.
It builds a `MapScene` and passes it through `createMapController` to `MapRenderer`.
The scene contains transit identities, both directions, selection, GPS and theme;
its membership and viewport filtering have no rendering-library dependency.

`render(scene)` never changes the camera. The controller owns initial framing,
pending recentre and route-scoped overview IDs. Engines report whether a camera
command was accepted and announce when a blocked animation has finished. Intents
are consumed before synchronous callbacks, so zoom-end cannot recurse into the
same command. Failed/denied GPS cancels recentre; later position polls do not follow
the user unless requested again. Overview uses both paths and waits for geometry.

The Leaflet adapter retains DOM markers, keyboard/touch behavior, route layers,
vehicle markers, tile validation/retry/attribution and camera defaults. Engine CSS
is in its lazy chunk. Destruction cancels timers and pending tile probes; unmounting
while the chunk loads does not create a detached map.

No abstract plugin registry, renderer setting or speculative PMTiles source handle
is introduced. Step 4 will implement this boundary in MapLibre and extend the
basemap input with a real package reader when the step 3 manager exists.

## Package boundary

`parseOfflineMapManifest(unknown, trustedReaderPolicy)` returns an owned descriptor
or throws. It performs no network or storage I/O and is not wired into the app yet.

Version 1 records region/version/date, `[west,south,east,north]`, native zoom range,
reader protocol compatibility, an exact supported renderer/tile-schema/style
profile, immutable HTTPS directory, archive and asset sizes/SHA256, total bytes,
attribution and local license files. Reader protocol version is independent of the
app's npm release. The application supplies allowed origins and supported profiles;
they must never be taken from the downloaded manifest.

Asset roles cover light/dark styles, glyphs, both sprite densities and licenses.
Paths are relative and canonical: literal `@2x`, `%20` for font-stack spaces, no
traversal/query/fragment/encoded separator aliases. Unknown executable fields and
file formats are rejected. The descriptor is bounded to 4096 assets, 2 GiB total
and 32 MiB per asset. The future fetcher must enforce `MAX_MANIFEST_BYTES` (1 MiB)
before JSON parsing. These are limits, not expected package sizes.

**A valid descriptor is not an installed/verified map.** Steps 2–3 must additionally
verify actual response lengths and hashes, redirect origins, PMTiles headers/schema,
style references, glyph coverage, sprite contents and application-shell availability.
Never execute package-provided JavaScript. Complete content is staged before an
IDB pointer activates it; the manifest parser cannot provide cross-store atomicity.

## Verification

Public seams: manifest input validation; renderer-independent scene and camera
commands; existing real-browser map interaction and built-PWA cache behavior.
Tests include Isovolta/N109, both directions above the marker cap, station identity,
regional coordinates outside the offline rectangle, delayed/denied GPS, active zoom,
synchronous camera callbacks, explicit overview and polling without camera movement.

Results and physical-device baseline are recorded in the
[baseline report](plans/2026-11-07-pmtiles-baseline.md). Run units/types/build before
browser suites, with one Playwright worker. No test requires production credentials.

## Package pipeline and next step

Step 2 adds an isolated generator, full content validator, browser gate and preview
publisher under `tools/pmtiles`; see the [implementation report](plans/2026-11-07-pmtiles-package-pipeline.md).
The descriptor remains shared/pure; no Node tooling enters the application bundle.
Distribution is local output with opt-in CI artifacts (disabled by default); R2 activation was declined by the user.
The provider-independent publication protocol is tested locally, with no cloud adapter.
Actual storage, atomic activation, update/delete UX and persistence remain steps 3–5.
Application dependency files are unchanged; tooling has its own pinned lockfile.
The current application audit reports 5 low and 5 moderate
advisories (no high/critical), including build-tool dependency chains; address those
in a separate dependency update, retaining the established SvelteKit/PWA peer compatibility.
