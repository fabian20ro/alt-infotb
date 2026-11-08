/// <reference lib="webworker" />
import { PrecacheController, PrecacheRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';
import { registerRasterRoutes } from './lib/map/raster-worker';
import { createShellCacheManager, inShellScope, shellCacheName, shellCachePrefix, type ShellRecord } from './lib/offline-maps/shell-cache';
import { isShellVersion, shellLifecycleLock, shellReaderLock } from './lib/offline-maps/shell-protocol';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string | null }> };
const scope = self.registration.scope;
const base = new URL(scope).pathname;
const version = __OFFLINE_SHELL_VERSION__;
if (!isShellVersion(version)) throw new Error('Invalid offline shell version');
const cacheName = shellCacheName(scope, version);
const metadataName = `alt-infotb-shell-registry-v1:${encodeURIComponent(scope)}`;
const metadataKey = new URL('__offline_shell_registry__/state', scope).href;
const lifecycle = async <T>(action: () => Promise<T>): Promise<T> => await navigator.locks.request(shellLifecycleLock(scope), { mode: 'exclusive' }, action);
const manifest = self.__WB_MANIFEST.map(entry => typeof entry === 'string'
 ? (entry === '/' ? base : entry) : entry.url === '/' ? { ...entry, url: base } : entry);
const precache = new PrecacheController({ cacheName });
precache.addToCacheList(manifest);
const keys = [...precache.getURLsToCacheKeys().values()].sort();
const homeKey = precache.getCacheKeyForURL(scope);
if (!homeKey) throw new Error('Offline shell entry missing');

async function complete(record: ShellRecord): Promise<boolean> {
 if (!await caches.has(record.cacheName)) return false;
 const cache = await caches.open(record.cacheName);
 for (const key of record.keys) {
  const response = await cache.match(key);
  if (!response) return false;
  await response.body?.cancel();
 }
 return true;
}
const manager = (async () => {
 const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(keys))));
 const fingerprint = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
 const own: ShellRecord = { version, cacheName, homeKey, keys, fingerprint };
 return createShellCacheManager(scope, own, {
  lifecycle,
  async read() {
   if (!await caches.has(metadataName)) return undefined;
   const response = await (await caches.open(metadataName)).match(metadataKey);
   return response ? response.json() : undefined;
  },
  async write(value) { await (await caches.open(metadataName)).put(metadataKey, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })); },
  names: () => caches.keys(), remove: name => caches.delete(name), complete,
  clients: async () => [...await self.clients.matchAll({ type: 'window', includeUncontrolled: true })],
  held: async () => (await navigator.locks.query()).held ?? [],
  replacement: () => !!self.registration.installing || !!self.registration.waiting,
  activeWorker: () => self.serviceWorker.state === 'activated',
  tryExclusive: async (readerVersion, action) => await navigator.locks.request(shellReaderLock(scope, readerVersion), { mode: 'exclusive', ifAvailable: true }, async lock => {
   if (!lock) return false;
   await action(); return true;
  })
 });
})();

// Explicit Workbox lifecycle calls keep *all* precache mutation inside the same
// lock as cleanup. Parallel convenience install listeners cannot provide that.
self.addEventListener('install', event => event.waitUntil(manager.then(value => value.install(() => precache.install(event)))));
self.addEventListener('activate', event => event.waitUntil(manager.then(value => value.activate(async () => {
 await precache.activate(event);
 // Do not run cleanupOutdatedCaches: exact protocol ownership and readers govern deletion.
})).then(() => self.clients.claim())));

// Register before PrecacheRoute, otherwise the cached root URL bypasses the pin.
registerRoute(new NavigationRoute(async ({ event }) => {
 const clientId = (event as FetchEvent).resultingClientId;
 return (await manager).navigation(clientId, async active => {
  const response = await (await caches.open(active.cacheName)).match(active.homeKey);
  if (!response) throw new Error('Active offline shell entry unavailable');
  return response;
 });
}, { allowlist: [new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)] }));
registerRoute(new PrecacheRoute(precache));

self.addEventListener('message', event => {
 const reply = (value: unknown) => event.ports[0]?.postMessage(value);
 const type = event.data?.type;
 if (!['OFFLINE_SHELL_STATUS', 'OFFLINE_SHELL_CLEANUP', 'OFFLINE_SHELL_ACTIVATE'].includes(type)) return;
 event.waitUntil((async () => {
  const source = event.source;
  if (!source || !('id' in source)) return;
  const client = await self.clients.get(source.id);
  if (!client || client.type !== 'window' || !inShellScope(scope, client.url)) return;
  const cacheManager = await manager;
  if (type === 'OFFLINE_SHELL_STATUS') {
   reply(await cacheManager.status(client, event.data.readerVersion, event.data.protocol));
  } else if (type === 'OFFLINE_SHELL_CLEANUP') {
   reply(await cacheManager.cleanup());
  } else {
   // Activation remains explicit and guarded by the page's transition lock.
   reply({ accepted: true }); await self.skipWaiting();
  }
 })().catch(() => reply(type === 'OFFLINE_SHELL_STATUS' ? { version, complete: false }
  : { deleted: [], retained: [], deferred: 'unavailable' })));
});

// Distribution bytes belong solely to the package manager, never the shell cache.
registerRoute(({ sameOrigin, url }) => sameOrigin &&
 (url.pathname.startsWith(`${base}__offline_downloads__/`) || url.pathname.startsWith(`${base}__offline_maps__/`)), new NetworkOnly());
// Old documents retain their version lock; serialized lookup also protects the
// short interval before returning an immutable response to a requesting client.
registerRoute(({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith(`${base}_app/immutable/`), async ({ request }) => {
 const cached = await lifecycle(async () => {
  for (const name of await caches.keys()) {
   if (!name.startsWith(`${shellCachePrefix(scope)}-precache-v2-`)) continue;
   const found = await (await caches.open(name)).match(request, { ignoreSearch: true });
   if (found) return found;
  }
 });
 // An unavailable network must not hold the lifecycle gate after cache lookup.
 return cached ?? fetch(request);
});
registerRasterRoutes(scope);
