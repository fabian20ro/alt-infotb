/// <reference lib="webworker" />
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { getTileProvider, isFreshTile, prepareTileForCache, validateTileResponse,
 tileCacheName, tileCachePrefix, tileCooldownUntil, TILE_MAX_AGE_SECONDS, TILE_MAX_ENTRIES } from './tile-policy';
declare const self: ServiceWorkerGlobalScope;

/** Shared raster/API policy; package resources never enter these caches. */
export function registerRasterRoutes(scope: string) {
// Arrival data remains network-only; offline must not masquerade as live arrivals.
registerRoute(({ url }) => url.hostname === 'info.stb.ro' || url.pathname.includes('/stb-api/'), new NetworkOnly());

for (const provider of ['carto', 'esri'] as const) {
	let cooldownUntil = 0;
	const strategy = new CacheFirst({
		cacheName: tileCacheName(scope, provider),
		plugins: [{
			requestWillFetch: async ({ request, state }) => {
				// CacheFirst checks cache before reaching this hook, so saved tiles stay usable.
				if (Date.now() < cooldownUntil) throw new Error('Map provider retry cooldown');
				const controller = new AbortController();
				if (state) state.timer = setTimeout(() => controller.abort(), 10000);
				return new Request(request, { signal: controller.signal });
			},
			fetchDidSucceed: async ({ response, state }) => {
				try {
					cooldownUntil = Math.max(cooldownUntil, tileCooldownUntil(response));
					return await validateTileResponse(response, provider);
				}
				finally { clearTimeout(state?.timer); }
			},
			fetchDidFail: async ({ state }) => { clearTimeout(state?.timer); },
			cacheWillUpdate: async ({ response }) => prepareTileForCache(response, provider),
			cachedResponseWillBeUsed: async ({ cachedResponse }) => cachedResponse && isFreshTile(cachedResponse) ? cachedResponse : null
		}, new ExpirationPlugin({
			maxEntries: TILE_MAX_ENTRIES,
			maxAgeSeconds: TILE_MAX_AGE_SECONDS[provider],
			purgeOnQuotaError: true
		})]
	});
	registerRoute(({ url }) => getTileProvider(url) === provider, (options) => {
		if (provider === 'carto' && !options.url.searchParams.get('key')?.trim()) {
			return Promise.resolve(new Response('Map key missing', { status: 503 }));
		}
		return strategy.handle(options);
	});
}

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const prefix = tileCachePrefix(scope);
		const current = new Set(['carto', 'esri'].map((provider) => tileCacheName(scope, provider as 'carto' | 'esri')));
		for (const name of await caches.keys()) {
			if (name.startsWith(prefix) && !current.has(name)) await caches.delete(name);
		}
		// The old unscoped cache may be shared on github.io. Remove only CARTO entries.
		if ((await caches.keys()).includes('map-tiles')) {
			const legacy = await caches.open('map-tiles');
			for (const request of await legacy.keys()) {
				if (/^(?:[a-z]\.)?basemaps\.cartocdn\.com$/.test(new URL(request.url).hostname)) await legacy.delete(request);
			}
			if ((await legacy.keys()).length === 0) await caches.delete('map-tiles');
		}
	})());
});

}
