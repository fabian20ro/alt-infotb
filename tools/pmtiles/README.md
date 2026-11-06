# București–Ilfov package pipeline (artifact only)

Builds and validates a self-contained regional PMTiles package. The production application, CARTO configuration and existing deployment workflow are unchanged. Distribution is deferred: the user declined R2 activation because of billing risk. This workflow creates downloadable GitHub artifacts; it does not provision cloud resources, configure credentials, or publish a map service.

`source.json` pins the regional archive's SHA256/size, dated Protomaps planet URL, PMTiles CLI version, asset commit/archive hash, bounds and package version. npm dependencies have a separate lockfile. The extraction includes a padded rectangle around București–Ilfov, not an administrative polygon or a promise of coverage for future regional routes.

## Local generation and validation

Requires Node ≥22.18, Python 3, curl, and Chromium for the optional browser gate. From this directory:

```sh
npm ci
python3 scripts/install-cli.py
npm run check
npm test
PUBLIC_ROOT=https://pmtiles-preview.invalid/packages/
npm run generate -- --public-root "$PUBLIC_ROOT" --output out --cache .cache --pmtiles-cli .bin/pmtiles
PACKAGE_DIR=$(node --input-type=module -e "import s from './source.json' with {type:'json'}; console.log('out/'+s.regionId+'/'+s.version)")
npm run verify -- --directory "$PACKAGE_DIR" --public-root "$PUBLIC_ROOT" --pmtiles-cli .bin/pmtiles
npm run build:preview
npx playwright install chromium
PMTILES_PACKAGE_DIR="$PACKAGE_DIR" PMTILES_PUBLIC_ROOT="$PUBLIC_ROOT" npm run test:browser
```

The installer checks the [official CLI 1.31.2 release](https://github.com/protomaps/go-pmtiles/releases/tag/v1.31.2) archive SHA256 before executing its binary. macOS/Linux ARM64 and x86_64 are supported. CI uses the version-matched Playwright image, so it does not download browser system packages.

Generation first reuses a checksum-verified archive in `.cache/`; otherwise it extracts the pinned bounds from the dated planet. Optional `--archive-file /path/basemap.pmtiles` or `--archive-url https://…/basemap.pmtiles` reuses a retained regional archive. Both must match the existing `source.json` SHA256 **and** byte count; they cannot substitute arbitrary data. HTTPS downloads reject redirects. An upstream URL becoming unavailable fails the job; it never silently selects newer data.

The output directory contains `manifest.json`, archive, both styles, all declared glyph ranges, sprites at 1×/2×, and licenses. URL paths encode font spaces as `%20`; disk filenames use actual spaces. Verification checks structural and semantic completeness, all file hashes, tile schema/content, referenced glyphs/icons, and the pinned CLI's archive validation.

The browser gate checks seven places (București, Otopeni, Snagov, Buftea, Cernica, Vidra, Periș), zooms 10/15/18, light/dark, and DPR1/2: **84 scenarios, one worker**. It verifies package bytes, disables network, checks rendered geometry/labels and missing resources, then writes `out/browser-receipt.json` bound to the manifest hash and Git commit. `PMTILES_TOOL_REVISION` may explicitly supply that full commit SHA. Traces/screenshots on failure are under `out/browser-results/`.

This viewer stores package files **in memory**. Offline rendering after download demonstrates package completeness; it does not implement durable storage, PWA installation, restart recovery, updates, or deletion in the production application. Those remain integration steps.

For a local/ADB viewer, run `PMTILES_PACKAGE_DIR="$PACKAGE_DIR" PMTILES_PUBLIC_ROOT="$PUBLIC_ROOT" node src/serve.ts` after building. Open `http://localhost:4186`; Android can use `adb reverse tcp:4186 tcp:4186`. The viewer loads files locally even though the manifest uses a reserved `.invalid` HTTPS root. `PMTILES_MANIFEST_URL` can select a separately hosted manifest for a future manual preview; this change supplies no hosting. The automated browser gate uses the local package.

## GitHub Actions and retained artifacts

The **PMTiles preview package** workflow has two modes:

- Pull requests touching this tooling or its imported contracts run isolated type checking and node tests. No regional download, credentials, or production deployment.
- **Run workflow** generates and independently validates the package, builds the preview, runs the browser gate and retains `out/` (including the regional archive, receipt, and evidence) for **90 days**. Artifact retention follows the existing repository policy; adjust this duration if that policy requires a smaller maximum.

Optional `archive_url` reuses a retained, public HTTPS archive; its pinned hash remains mandatory. There is no publication input, secret-bearing job, schedule, or push-triggered publication. Browser receipts are tied to `github.sha`; workflow inputs cannot choose their revision. No repository variables or secrets are needed.

In **Actions → PMTiles preview package → Run workflow**, leave `archive_url` empty to use the source cache or extract from the pinned planet. After success, download the `pmtiles-package-<commit SHA>` artifact from the run summary. Its root contains `bucuresti-ilfov/<version>/`, the browser receipt, and test evidence. Extract into `out/` to use the local viewer. If a browser gate fails, the regional extract is still retained when generation completed, but there is no successful receipt.

Download retained archives before artifact expiration for long-term reproducibility. Artifact storage and retention use the existing GitHub repository's limits. For a later regeneration, supply the extracted `basemap.pmtiles` with `--archive-file`; credentials are unnecessary. The source cache is an optimization, not the archival copy.

The generated manifest deliberately uses `https://pmtiles-preview.invalid/packages/`. A future public distribution must regenerate against its approved public root, because the manifest includes that URL. Use a separate output directory when experimenting with a different root. No actual public HTTP endpoint or durable phone installation is established by an artifact-only workflow.

## Future distribution boundary

`src/publish.ts` defines a provider-neutral `ObjectStore` interface; it is not wired to the CLI or a cloud provider. Its in-memory-store and local HTTP fault tests establish the intended publication contract:

- Capture committed `latest.json` ETag before uploads; create versioned objects atomically with `If-None-Match: *`.
- Accept retries only when existing bytes match; reject changed bytes under an existing version.
- Verify public hashes, HEAD, CORS/preflight, start/middle/end/suffix ranges, 416 and stale If-Range behavior. Compare range bodies to local bytes.
- Update latest last, with an atomic ETag condition; no unconditional fallback. Failed uploads/public verification leave previous latest intact.

A future adapter must implement these atomic preconditions rather than emulate them with separate reads and unconditional writes. It must also pass verification against the **actual** chosen endpoint. These tests do not prove a hosted provider's behavior. Distribution choice and its cost limits need a separate decision before integration.

The contract keeps versioned objects immutable (`max-age=31536000`) and latest short-lived (`max-age=60, must-revalidate`). It retains old versions, has no automatic deletion, and rejects replacing newer `dataDate` with older data. This pipeline requires `YYYYMMDD-vN` matching `dataDate`; N is a positive integer and same-date downgrades are rejected, so retrying v1 cannot replace an already-promoted v2.

Updating a package requires a reviewed `source.json` change: new version/data date, exact archive hash/size, any compatibility-profile changes, then generation/content/browser verification again. Never overwrite an existing version to repair data. The future application download manager will own transactional activation, persistent-storage requests, local package deletion and recovery; hosting retention/garbage collection must preserve versions still needed by clients.
