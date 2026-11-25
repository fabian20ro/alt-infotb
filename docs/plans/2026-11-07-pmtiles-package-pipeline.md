# PMTiles step 2: reproducible package and preview distribution

Status: implemented in an isolated tool package; production application remains on
its existing renderer and providers. The user declined R2 activation/billing. Distribution in this step is local output, with an optional
GitHub Actions artifact (off by default); no cloud storage account or deployment is created. Operational commands: [pipeline README](../../tools/pmtiles/README.md).

## Implementation

- `tools/pmtiles/source.json` pins the planet date, regional extract SHA256/bytes,
  CLI version, asset repository commit and ZIP digest. No implicit latest source.
- Generator stages a complete candidate, expands bounded font aliases into regular
  files, creates Romanian light/dark styles, preserves license notices, hashes every
  file and validates the candidate before exposing its immutable directory.
- Validator imports the step 1 descriptor contract. It verifies files, PMTiles
  structure/header/schema, every addressed vector tile, actual feature-dependent
  icon/font references, actual shaped text glyph IDs, sprite PNG data/atlas geometry
  and all1,024 BMP font ranges. The validator uses pure shaping/Unicode helpers
  from the pinned MapLibre dependency; the profile explicitly uses local
  sans-serif rasterization for the scripts MapLibre handles on-device.
  It rejects external style resources, executable source overrides, extras and
  symlinks. This is structural/resource validation, not proof of map accuracy or
  readability. Browser checks complement it.
- Preview renderer consumes verified downloaded bytes in memory. It exercises seven
  localities, z10/z15/z18, both themes and DPR1/2 with the network disabled after
  preparation: 84 scenarios. The successful receipt binds the manifest digest and
  tool commit. This harness does not implement the app's persistent package manager.
- The provider-independent publication protocol is tested against an in-memory
  object store and a local HTTP fault server. Its adapter contract requires atomic
  `If-None-Match: *`; retries require identical bytes. It verifies public hashes,
  HEAD, range bodies/metadata, suffix/invalid ranges and CORS before updating
  `latest`. Same-date package revisions must increase. The mutable pointer uses
  a captured ETag and atomic `If-Match`, so stale
  publishers cannot overwrite a concurrent winner. No unconditional retry.
- A separate workflow runs cheap tooling tests on PRs; manual generation retains
  the verified regional extract locally; optional CI artifacts expire after7 days. There is no provider adapter,
  publication CLI, credential configuration or cloud deployment job. The
  application's deploy workflow is unchanged.

## Measured package

Source: Protomaps 2026-11-06, schema4.15.2; style5.7.2; CLI1.31.2.
Bounds `[25.80,44.19,26.49,44.80]`; native z0–15, overzoom in renderer.

| Measure | Result |
|---|---:|
| PMTiles archive | 28,789,758 bytes |
| Complete package, excluding manifest/app shell | 47,176,137 bytes (47.18 MB / 44.99 MiB) |
| Declared assets | 1,039 |
| Total files including archive and manifest | 1,041 |
| Addressed tiles validated | 6,807 / 6,807 |
| Feature instances decoded across zooms | 806,282 |
| Decompressed vector payload | 45,239,538 bytes |

A fresh extraction independently reproduced archive SHA256
`54ef47be5f854d74d9de94e5b7670f2261aa45d1b0706061759cf9c706463180`.
It transferred about30 MB in65 range requests. This is generation cost, not a
measurement of a user's mobile download. The source asset ZIP is6,731,115 bytes;
expanded font aliases increase the complete package size.

## Verification record

- App:1,195 tests/32 suites; Svelte check0 errors/warnings; static build; catalog,
  service-worker and shared API type checks pass. App package/lockfile unchanged.
- Isolated tools:60 Node tests pass, including corruption/ZIP/race/range faults,
  required ASCII/Romanian glyph removal and receipt/server guards; typecheck passes.
- Offline browser matrix:84/84 scenarios on Chromium with software WebGL for CI,
  one worker, no HTTP(S) attempts after offline transition. Light/dark screenshots
  visually inspected for streets, labels, parks, water, POIs and attribution.
- Physical Pixel6a, Chrome156.0.8078.49, DPR2.625:42/42 scenarios,0 offline HTTP
  attempts,0 renderer/missing-sprite errors.47,176,137 bytes/1,040 payload files
  downloaded+verified. Download through ADB and first render:2,515 ms; slowest
  measured scenario idle:217 ms. These are local USB observations, not mobile
  internet or production performance guarantees. Tab-scoped offline emulation was
  restored afterward; existing prototype/PWA data was preserved.
- Fresh regional extraction matches the original SHA256. CLI installer archive
  checksum verified for local macOS and CI Linux; workflow lint passes.
- Full text audit:3,032,412 evaluated text sections,13,078,142 packaged glyph
  dependency checks,6 local character dependency checks,0 missing packaged glyphs.
  Device font availability for locally rasterized scripts remains a renderer/device
  property; package validation does not certify every operating system font.
- Live public hosting, persistent install/restart, app integration and Brave-specific
  behavior are not verified by this step.

## Discoveries and remaining work

- Upstream style references `townhall`, absent from its pinned sprites. The explicit
  fallback preserves the label and uses the supplied `building` symbol.
- Devanagari font paths intentionally alias other font payloads for most ranges;
  four ranges use their own internal stack name. Preserve validated aliases rather
  than discarding non-Latin coverage.
- Valid MVT feature IDs can exceed JavaScript's safe integer range. The validator
  bounds/skips these optional IDs before using the existing protobuf decoder;
  feature-ID-dependent style expressions are outside this pinned profile.
- The complete package contains over1,000 objects. Request count is a future
  optimization target; do not trim glyphs based on an assumption about local scripts.
- R2 is not enabled; the user explicitly declined activation to avoid billing risk.
  Cloud distribution is deferred. Choose a host with no billing exposure before
  enabling remote installation; verify real Range/CORS behavior rather than assuming
  any static host supports it. The local fault server is not evidence about a provider.
- Retain the regional archive independently of temporary planet-host retention.
  Opt-in CI artifacts expire after7 days; save an exported package separately for durable
  retention. Once the pinned planet expires and no retained extract/cache exists,
  regeneration intentionally fails instead of silently changing source. No automatic
  cloud garbage collection in this step.
- App dependencies and lockfile are preserved. Their existing audit has5 low and
  5 moderate findings, no high/critical; handle compatible security updates separately.

## Recommended next implementation

Step3: a package manager behind an independent storage interface, before UI or
renderer replacement. Keep the package protocol shared and pure; keep Node
generation/publishing code outside the browser bundle. Renderer compatibility must
also preserve the pinned text-shaping/local-font policy; changing it requires
revalidating packages rather than assuming that the manifest schema alone suffices.

1. Inject bounded fetch, OPFS, CacheStorage, IndexedDB and Web Locks at the manager
   boundary. Namespace every resource by app/region/version. Add a real-browser
   integration adapter alongside deterministic failure-injection tests.
2. Implement install/cancel/recovery: streaming candidate download/hash, resource
   verification, durable operation journal, then one short IDB activation transaction.
   An interrupted candidate never becomes active.
3. Implement reader leases and update: old generation remains available until the
   new generation renders successfully and old readers release their shared locks.
   Retain fallback through that confirmation; prohibit accumulating a third generation.
4. Implement delete/recovery and cross-tab notifications. Report reclaimed storage
   only after physical removal; a suspended reader may defer deletion.
5. Expose persistence as a separate observed state, with explicit user-triggered
   `persist()` and install-PWA guidance. Refusal is not download failure. Test actual
   granted/refused behavior, quota failures and restart offline on Pixel Chrome/Brave.

Acceptance: deterministic fault tests at each transfer/commit boundary; real-browser
crash/restart/update/delete/two-tab tests; full installed package and app shell
available after server shutdown. No production activation until later renderer/UI
parity and opt-in rollout checks pass.
