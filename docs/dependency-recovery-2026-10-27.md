# Deployment recovery after the October security updates

## Decision

Temporarily use SvelteKit 2.70.3 and Vitest 4.1.12 while preserving the other security updates merged through `93c2fb4`. Do not bypass npm peer validation with `--force` or `--legacy-peer-deps`.

SvelteKit 3.0.0 cannot install with the current `@sveltejs/adapter-static` 3.0.10 and `@vite-pwa/sveltekit` 1.1.0, which support Kit 2. Kit 3 also requires TypeScript 6 and a newer cookie dependency than the existing global override permits. This is a coordinated migration, not an isolated package bump.

The root Vitest update removes the remaining moderate Vitest/mocker audit findings. The root Vite, devalue, serialize-javascript, fast-uri and brace-expansion patches remain; the shared-api and Worker manifests/lockfiles remain unchanged from main.

## Temporary security assessment

Assessment date: **2026-10-27**. This is a documented compatibility exception, not a claim of zero vulnerabilities. Keep npm audit findings visible.

| Advisory | Preconditions | Current applicability |
| --- | --- | --- |
| [GHSA-pfhg-q3qv-9q6r](https://github.com/advisories/GHSA-pfhg-q3qv-9q6r), low | Enhanced form submission and a redirect target that triggers the affected handling | No `use:enhance`, `$app/forms`, or form actions in application sources. |
| [GHSA-27mw-82g8-phjj](https://github.com/advisories/GHSA-27mw-82g8-phjj), low | Untrusted `cache-control` passed through `setHeaders` while prerendering | No `setHeaders` calls in application sources. |

These two advisories also propagate to dependent packages, so the root audit reports three low package entries. They are not three independent vulnerabilities. Reassess before introducing either feature, on new advisories, and when a compatible patched Kit 2 release or Kit 3 PWA integration becomes available. The maintainers should remove this exception through the coordinated Kit 3 migration; do not dismiss the alerts as permanently irrelevant.

## CI browser environment

The Deploy build job uses the official `mcr.microsoft.com/playwright:v1.58.2-noble` image, with the existing Node 22 setup. Chromium/WebKit and their Linux dependencies are already installed; the build no longer downloads Ubuntu browser dependencies on every run. This removes the installation step that timed out during deployment of PR50.

Update the image tag, its early version assertion and the locked `@playwright/test` version together. The assertion also verifies executable access for both required browsers. Preserve the image's browser path and run Playwright with one worker. See the official [Docker](https://playwright.dev/docs/docker) and [CI](https://playwright.dev/docs/ci) instructions.

The fake-key and missing-key builds, production-worker tests, live CARTO canary and final production-key rebuild remain mandatory. PR verification does not publish the app. After merge, require a successful Pages deployment before checking production cache behavior.

## Follow-up

1. Migrate Kit, static adapter, TypeScript, PWA integration and cookie override together; repeat production registration, scope, cached-tile, expiry and offline-navigation tests.
2. The separate station-catalog workflow still installs browsers when its optional publication path runs. Move that verification to a prebuilt browser environment separately, preserving its GitHub CLI/history/publication dependencies. Automatic catalog publication remains disabled.
3. After the recovery deploy, verify actual service-worker control, tile-cache entries, no provider fetch for an unexpired cached tile, and offline reload on the public site. Browser storage eviction and uncached areas still limit offline coverage.
