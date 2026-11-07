import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../dist-storage/', import.meta.url));
async function entries(root: string): Promise<string[]> {
	const result: string[] = [];
	for (const item of await readdir(root, { withFileTypes: true })) {
		const filename = path.join(root, item.name);
		if (item.isDirectory()) result.push(...await entries(filename));
		else if (item.isFile() && !['sw.js', 'shell-assets.json'].includes(item.name)) result.push(filename);
	}
	return result.sort();
}
const files = await entries(directory);
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(file));
const cacheName = `alt-infotb:pmtiles-storage-preview:shell:${hash.digest('hex').slice(0, 16)}`;
const urls = ['/', '/config.json', '/shell-assets.json', ...files.map(file => `/${path.relative(directory, file).split(path.sep).join('/')}`)];
await writeFile(path.join(directory, 'shell-assets.json'), JSON.stringify({ cacheName, urls }));
await writeFile(path.join(directory, 'sw.js'), `// Isolated test shell. Never installed by the production application.
const CACHE = ${JSON.stringify(cacheName)};
const URLS = ${JSON.stringify(urls)};
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(URLS);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/package/')) return;
  if (!URLS.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request, {ignoreSearch:true})).then(hit => hit || fetch(event.request)));
});
`);
console.log(`Storage test shell: ${urls.length} entries, ${cacheName}`);
