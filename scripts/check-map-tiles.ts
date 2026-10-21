import { pathToFileURL } from 'node:url';
import { CARTO_ORIGIN, validateTileResponse } from '../src/lib/map/tile-policy.ts';

/** Small live canary: only four tiles, no area downloads, no key/URL logging. */
export async function checkMapTiles(key: string | undefined, fetchTile: typeof fetch = fetch): Promise<string[]> {
 const apiKey = key?.trim();
 if (!apiKey || /^(?:pwa-regression|map-interaction)-test-key$/.test(apiKey)) {
  throw new Error('Set the repository Actions variable VITE_CARTO_API_KEY before deploying. Get a key at https://www.carto.com/basemaps/apikey/.');
 }
 const checked: string[] = [];
 for (const [theme, path] of [['light', 'rastertiles/voyager'], ['dark', 'dark_all']] as const) {
  for (const resolution of ['', '@2x']) {
   const url = new URL(`${CARTO_ORIGIN}/${path}/15/18759/11860${resolution}.png`);
   url.searchParams.set('key', apiKey);
   // Read and validate the body inside the deadline, too. Never log the URL or fetch error.
   const controller = new AbortController();
   let timer: ReturnType<typeof setTimeout> | undefined;
   const label = `${theme}${resolution || '@1x'}`;
   try {
    const probe = async () => {
     const response = await fetchTile(url, {
      signal: controller.signal,
      headers: { Referer: 'https://fabian20ro.github.io/alt-infotb/', Origin: 'https://fabian20ro.github.io' }
     });
     if (response.status !== 200) throw new Error(`Basemap ${label}: HTTP ${response.status}; verify the CARTO key, website restriction and quota.`);
     const allowedOrigin = response.headers.get('access-control-allow-origin');
     if (allowedOrigin !== '*' && allowedOrigin !== 'https://fabian20ro.github.io') {
      throw new Error(`Basemap ${label}: provider does not allow the application origin through CORS.`);
     }
     if ((await validateTileResponse(response, 'carto')).status !== 200) {
      throw new Error(`Basemap ${label}: invalid image or known API-key placeholder; publication stopped.`);
     }
    };
    await Promise.race([probe(), new Promise<never>((_, reject) => {
     timer = setTimeout(() => { controller.abort(); reject(new Error(`Basemap ${label}: timed out.`)); }, 10000);
    })]);
    checked.push(label);
   } catch (error) {
    if (error instanceof Error && error.message.startsWith(`Basemap ${label}:`)) throw error;
    throw new Error(`Basemap ${label}: network or response failure; check provider availability.`);
   } finally {
    clearTimeout(timer);
   }
  }
 }
 return checked;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 checkMapTiles(process.env.VITE_CARTO_API_KEY)
  .then((checked) => console.log(`Basemap checks passed: ${checked.join(', ')}. Known-placeholder and CORS checks are not a universal visual-content guarantee.`))
  .catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
