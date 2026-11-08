/// <reference lib="webworker" />
import { clientsClaim, setCacheNameDetails, cacheNames } from 'workbox-core';
import { precacheAndRoute, createHandlerBoundToURL, getCacheKeyForURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import { registerRasterRoutes } from './lib/map/raster-worker';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string | null }> };
const scope = self.registration.scope;
const base = new URL(scope).pathname;
const version = __OFFLINE_SHELL_VERSION__;
const shellPrefix = `alt-infotb-preview-${encodeURIComponent(base)}`;
setCacheNameDetails({ prefix: shellPrefix, suffix: version });
// A distinct cache per shell preserves lazy chunks in old tabs. Never run
// cleanupOutdatedCaches here: package caches and old readers outlive an app update.
const manifest = self.__WB_MANIFEST.map(entry => typeof entry === 'string'
 ? (entry === '/' ? base : entry) : entry.url === '/' ? { ...entry, url: base } : entry);
const shellUrls = manifest.map(entry => new URL(typeof entry === 'string' ? entry : entry.url, scope).href);
precacheAndRoute(manifest);
clientsClaim();
// No automatic skipWaiting: explicit UI activation, protected by the page's lock.
self.addEventListener('message', event => {
 const reply = (value: unknown) => event.ports[0]?.postMessage(value);
 if (event.data?.type === 'OFFLINE_SHELL_STATUS') event.waitUntil((async () => {
  const cache = await caches.open(cacheNames.precache);
  const complete = shellUrls.length > 0 && (await Promise.all(shellUrls.map(url => cache.match(getCacheKeyForURL(url) ?? url)))).every(Boolean);
  reply({ version, complete });
 })().catch(() => reply({ version, complete: false })));
 if (event.data?.type === 'OFFLINE_SHELL_ACTIVATE') event.waitUntil((async () => {
  // Only a window in this application's scope can request activation.
  const source = event.source;
  if (!source || !('id' in source)) return;
  const client = await self.clients.get(source.id);
  if (!client || !client.url.startsWith(scope)) return;
  reply({ accepted: true });
  await self.skipWaiting();
 })());
});
registerRoute(new NavigationRoute(createHandlerBoundToURL(base), {
 allowlist: [new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)]
}));
// Distribution bytes belong solely to the package manager. No runtime/precache copy.
registerRoute(({ sameOrigin, url }) => sameOrigin &&
 (url.pathname.startsWith(`${base}__offline_downloads__/`) || url.pathname.startsWith(`${base}__offline_maps__/`)), new NetworkOnly());
// Old tabs can import their immutable chunks after a newer worker claims them.
// Restrict fallback to this application's hashed build assets and owned shell caches.
registerRoute(({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith(`${base}_app/immutable/`), async ({ request }) => {
 for (const name of await caches.keys()) {
  if (!name.startsWith(`${shellPrefix}-`)) continue;
  const found = await (await caches.open(name)).match(request, { ignoreSearch: true });
  if (found) return found;
 }
 return fetch(request);
});
registerRasterRoutes(scope);
