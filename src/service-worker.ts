/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import {
	getTileProvider, isFreshTile, prepareTileForCache, validateTileResponse,
	tileCacheName, tileCachePrefix, tileCooldownUntil, TILE_MAX_AGE_SECONDS, TILE_MAX_ENTRIES
} from './lib/map/tile-policy';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string | null }> };

const scope = self.registration.scope;
const base = new URL(scope).pathname;
self.skipWaiting();
clientsClaim();
// SvelteKit's prerender manifest can label index.html as '/' even for a subpath
// build. Resolve that entry to this registration's scope, never the origin home.
precacheAndRoute(self.__WB_MANIFEST.map((entry) => {
	if (typeof entry === 'string') return entry === '/' ? base : entry;
	return entry.url === '/' ? { ...entry, url: base } : entry;
}));
cleanupOutdatedCaches();

// The app is deployed under a subpath: never fall back to the origin's unrelated home page.
registerRoute(new NavigationRoute(createHandlerBoundToURL(base), {
	allowlist: [new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)]
}));

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

registerRoute(({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith(base) && /\.(?:js|css|html|svg|png|woff2?|json)$/.test(url.pathname),
	new StaleWhileRevalidate({
		cacheName: `alt-infotb-static-${encodeURIComponent(base)}`,
		plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 180, purgeOnQuotaError: true })]
	}));

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
