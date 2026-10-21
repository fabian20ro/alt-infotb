# CARTO key, map cache and deployment

## Obtain the key

Open [CARTO Basemaps](https://www.carto.com/basemaps/apikey/) and choose **Request a key**. Follow the email flow; existing keys and website restrictions are managed in the [Basemaps dashboard](https://dashboard.basemaps.carto.com/). Use a **Basemaps key**, not an STB credential or a Cloudflare token.

Restrict the key to the deployed application's website, `fabian20ro.github.io`. For local development, use a separate development key allowing `localhost` as supported by the dashboard. CARTO sees the browser's referrer origin; a repository path is not a separate web origin. Keep the required OSM/CARTO attribution visible.

The key is public browser configuration: users can inspect it in requests. Restrict its allowed website and monitor usage in CARTO. It is one key for this deployed app, not one key per phone. Independently hosted copies supply their own key. Current plans and limits are on the provider page; caching does not replace authorization.

## GitHub Pages

In [this repository's Actions variables](https://github.com/fabian20ro/alt-infotb/settings/variables/actions):

1. **Settings → Secrets and variables → Actions → Variables → New repository variable**.
2. Name: **`VITE_CARTO_API_KEY`**. Value: the CARTO Basemaps key.
3. Save before merging the map repair PR.
4. Merge the PR, or after updating a key, run **Actions → Deploy → Run workflow → main**. Changing the variable alone does not rebuild the static app.

The Deploy workflow reads `${{ vars.VITE_CARTO_API_KEY }}` for the final Pages build. It stops publication if the key is missing/test-only or the live canary detects failed authorization, CORS, HTTP errors or a known placeholder. The previous deployment stays available on failure. The canary makes at most four requests per deployment (light/dark, normal/retina); it does not download an area or run on PRs. Canary success is not a universal guarantee against every possible provider error image.

Tests first build with a fake key and intercept provider traffic. A separate final build replaces that test artifact before Pages upload. No production key is needed to verify a PR, and test traces do not contain it.

**No Cloudflare update is required:** CARTO tiles are requested by the browser. The STB Worker and its credentials are unchanged.

## Local development

Create or edit the ignored `.env.local` file:

```dotenv
VITE_CARTO_API_KEY=your_carto_basemaps_key
```

Restart `npm run dev` after editing it. For production preview, run `npm run build` again, then `npm run preview`. Do not commit the populated file. Missing configuration leaves station/route overlays available and offers an explicit satellite fallback instead of requesting unauthorized CARTO tiles.

Optional live check, using `.env.local` or the process environment:

```sh
npm run maps:check
```

This deployment canary sends the production website origin/referrer. A development-only key restricted to localhost can fail this production check; that is expected. Output omits the key and request URLs.

## Cache behavior

The production layout registers the worker and links the manifest under `/alt-infotb/`. Leaflet uses CORS requests. CARTO tiles with a key use CacheFirst, at most 500 entries per provider, with a seven-day ceiling. Satellite entries use at most one day and explicit provider freshness; no-store/error/opaque responses are not persisted. Known API-key placeholder PNGs are rejected even when the provider reports HTTP200. One initial visible-tile probe protects the first uncontrolled online visit; later controlled requests are validated by the worker.

Provider/style/URL including the key identify cached tiles. New map cache names are scoped to this application and versioned. Activation removes obsolete map entries; unrelated caches, settings and favorites remain. Cache Storage and browser HTTP cache are separate; changed authorized URLs also avoid reuse of the old unauthenticated placeholder URLs.

Only viewed tiles are requested. Cached, unexpired areas can render offline; uncached areas and fresh arrivals need connectivity. Browser storage can be evicted. Failed tile loads keep a visible status, a manual retry with cooldown, and a satellite/street switch. There is no automatic retry loop. Provider-level cooldown honors readable Retry-After on 429/503 (15 seconds when absent); valid cached tiles remain usable. This cooldown is held in the current worker/page session, not a durable quota ledger across browser restarts. Switching providers updates attribution too.

## Verification and remaining limits

```sh
npm run check
npm run check:catalog
npm run check:service-worker
npm test
VITE_CARTO_API_KEY=pwa-regression-test-key npm run build
npm run test:e2e:pwa
VITE_CARTO_API_KEY= npm run build
PWA_TEST_NO_KEY=1 npm run test:e2e:pwa
npm run test:e2e:map
```

Run these sequentially: Vite/Svelte regeneration can invalidate an active browser test. The production suite checks actual worker control, cache hits without a second provider fetch, offline navigation/tiles, uncached failures, HTTP errors, placeholder200, provider cooldown, the 500-entry eviction bound, theme switching and cache migration. The separate interaction suite covers desktop/mobile Chromium and mobile WebKit. Physical iOS installed-PWA lifecycle/storage eviction remains device-specific.

The placeholder signatures are an incident regression detector, not an image classifier. A future provider change may require a new signature or a visual inspection. PMTiles hosting remains an optional separate migration; this repair keeps Leaflet and the existing providers.
