/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { registerRasterRoutes } from './lib/map/raster-worker';

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

registerRasterRoutes(scope);

registerRoute(({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith(base) && /\.(?:js|css|html|svg|png|woff2?|json)$/.test(url.pathname),
	new StaleWhileRevalidate({
		cacheName: `alt-infotb-static-${encodeURIComponent(base)}`,
		plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 180, purgeOnQuotaError: true })]
	}));
