import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { syntheticMapTile } from './fixtures/map-tile';

const APP_PATH = '/alt-infotb/';
const TEST_KEY = 'pwa-regression-test-key';
const validTile = syntheticMapTile();
const placeholder = await readFile(new URL('./fixtures/carto-api-key-required.png', import.meta.url));
const headers = {
	'access-control-allow-origin': '*',
	'access-control-expose-headers': 'ETag',
	'cache-control': 'public, max-age=604800'
};

function tileUrl(x: number, style = 'dark_all'): string {
	return `https://basemaps.cartocdn.com/${style}/10/${x}/300.png?key=${TEST_KEY}`;
}

async function tileNetwork(context: BrowserContext) {
	const outgoing: string[] = [];
	const workerOutgoing: string[] = [];
	const responses = new Map<string, { status: number; body?: Buffer }>();
	const state = { offline: false, placeholder: false };
	await context.route('**/*', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.hostname === 'localhost') return route.continue();
		if (url.hostname.endsWith('cartocdn.com') || url.hostname === 'server.arcgisonline.com') {
			outgoing.push(request.url());
			if (request.serviceWorker()) workerOutgoing.push(request.url());
			if (state.offline) return route.abort('internetdisconnected');
			const response = responses.get(request.url());
			return route.fulfill({
				status: response?.status ?? 200,
				contentType: 'image/png',
				headers,
				body: response?.body ?? (state.placeholder ? placeholder : validTile)
			});
		}
		// Arrival responses are independent from basemap/PWA behavior.
		return route.fulfill({ status: 200, headers, body: Buffer.alloc(0) });
	});
	return { outgoing, workerOutgoing, responses, state };
}

async function openControlled(page: Page) {
	await page.goto(APP_PATH);
	await expect(page.locator('.station-marker').first()).toBeVisible();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
}

async function fetchTile(page: Page, url: string) {
	return page.evaluate(async (url) => {
		try {
			const response = await fetch(url, { mode: 'cors', cache: 'no-store' });
			const bytes = await response.arrayBuffer();
			return { status: response.status, size: bytes.byteLength };
		} catch {
			return { status: 0, size: 0 };
		}
	}, url);
}

async function cached(page: Page, url: string) {
	return page.evaluate(async (url) => !!await caches.match(url), url);
}

test('production manifest and scope install; cached tiles avoid another worker fetch and work offline', async ({ page, context }) => {
	const network = await tileNetwork(context);
	await openControlled(page);
	const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
	expect(manifest).toBeTruthy();
	const manifestData = await page.evaluate(async (href) => (await fetch(href!)).json(), manifest);
	expect(manifestData.scope).toBe(APP_PATH);
	expect(manifestData.start_url).toBe(APP_PATH);
	expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope))
		.toBe(`http://localhost:4173${APP_PATH}`);

	const url = tileUrl(800);
	const response = page.waitForResponse((response) => response.url() === url);
	expect((await fetchTile(page, url)).status).toBe(200);
	expect((await response).fromServiceWorker()).toBe(true);
	await expect.poll(() => cached(page, url)).toBe(true);
	expect(network.workerOutgoing.filter((request) => request === url)).toHaveLength(1);
	expect((await fetchTile(page, url)).status).toBe(200);
	expect(network.outgoing.filter((request) => request === url)).toHaveLength(1);
	// Revisit under worker control so the visible Leaflet tiles are cached too.
	await page.reload();
	await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
	await expect.poll(() => page.evaluate(async () => {
		const images = [...document.querySelectorAll<HTMLImageElement>('.leaflet-tile-loaded')];
		return images.length > 0 && (await Promise.all(images.map(async (image) => !!await caches.match(image.src)))).every(Boolean);
	})).toBe(true);

	network.state.offline = true;
	await context.setOffline(true);
	expect((await fetchTile(page, url)).status).toBe(200);
	expect((await fetchTile(page, tileUrl(801))).status).not.toBe(200);
	await page.reload();
	await expect(page.locator('.station-marker').first()).toBeVisible();
	await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
	expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	expect(network.outgoing.filter((request) => request === url)).toHaveLength(1);
});

test('authorization, quota and server errors never enter the tile cache', async ({ page, context }) => {
	const network = await tileNetwork(context);
	await openControlled(page);
	for (const [index, status] of [401, 403, 429, 503].entries()) {
		const url = tileUrl(810 + index);
		network.responses.set(url, { status });
		expect((await fetchTile(page, url)).status).not.toBe(200);
		expect(await cached(page, url)).toBe(false);
		network.responses.set(url, { status: 200 });
		expect((await fetchTile(page, url)).status).toBe(200);
		await expect.poll(() => cached(page, url)).toBe(true);
		expect(network.workerOutgoing.filter((request) => request === url)).toHaveLength(2);
	}
});

test('HTTP 200 CARTO key watermark is rejected by the production worker', async ({ page, context }) => {
	const network = await tileNetwork(context);
	await openControlled(page);
	const url = tileUrl(820);
	network.responses.set(url, { status: 200, body: placeholder });
	expect((await fetchTile(page, url)).status).not.toBe(200);
	expect(await cached(page, url)).toBe(false);
	network.responses.set(url, { status: 200 });
	expect((await fetchTile(page, url)).status).toBe(200);
	await expect.poll(() => cached(page, url)).toBe(true);
	expect(network.workerOutgoing.filter((request) => request === url)).toHaveLength(2);
});

test('expired cache entries refetch and a changed key keeps a separate cache identity', async ({ page, context }) => {
	const network = await tileNetwork(context);
	await openControlled(page);
	const url = tileUrl(825);
	expect((await fetchTile(page, url)).status).toBe(200);
	await expect.poll(() => cached(page, url)).toBe(true);
	await page.evaluate(async (url) => {
		for (const name of await caches.keys()) {
			const cache = await caches.open(name);
			const response = await cache.match(url);
			if (!response) continue;
			const headers = new Headers(response.headers);
			headers.set('x-alt-infotb-tile-expires', String(Date.now() - 1));
			await cache.put(url, new Response(await response.arrayBuffer(), { headers }));
		}
	}, url);
	expect((await fetchTile(page, url)).status).toBe(200);
	expect(network.workerOutgoing.filter((request) => request === url)).toHaveLength(2);
	const rotatedKey = url.replace(TEST_KEY, 'rotated-test-key');
	expect((await fetchTile(page, rotatedKey)).status).toBe(200);
	await expect.poll(() => cached(page, rotatedKey)).toBe(true);
	expect(network.workerOutgoing.filter((request) => request === rotatedKey)).toHaveLength(1);
	expect(await cached(page, url)).toBe(true);
});

test('activation migrates only legacy map cache and keeps favorites, settings and unrelated caches', async ({ page, context }) => {
	await tileNetwork(context);
	await context.route('**/alt-infotb/pwa-bootstrap', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Cache migration setup</title>' }));
	await page.goto(`${APP_PATH}pwa-bootstrap`);
	const favorite = JSON.stringify([{ id: 3570, name: 'Piața Romană', lat: 44.446, lon: 26.097 }]);
	await page.evaluate(async (favorite) => {
		localStorage.setItem('alt-stb-favorites', favorite);
		localStorage.setItem('alt-stb-settings', JSON.stringify({ theme: 'light', lang: 'ro' }));
		await (await caches.open('map-tiles')).put('https://a.basemaps.cartocdn.com/dark_all/10/1/1.png', new Response('old placeholder'));
		await (await caches.open('unrelated-app')).put('/unrelated', new Response('keep me'));
	}, favorite);
	await openControlled(page);
	await expect.poll(() => page.evaluate(() => caches.has('map-tiles'))).toBe(false);
	expect(await page.evaluate(() => localStorage.getItem('alt-stb-favorites'))).toBe(favorite);
	expect(await page.evaluate(() => localStorage.getItem('alt-stb-settings'))).toBe(JSON.stringify({ theme: 'light', lang: 'ro' }));
	expect(await page.evaluate(async () => (await caches.match('/unrelated'))?.text())).toBe('keep me');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('placeholder on a fresh install retains stations and offers an attributed satellite fallback', async ({ page, context }) => {
	const network = await tileNetwork(context);
	network.state.placeholder = true;
	await openControlled(page);
	await expect(page.getByTestId('tile-status')).toContainText('Fundalul hărții nu este disponibil complet');
	await expect(page.locator('.station-marker').first()).toBeVisible();
	network.state.placeholder = false;
	await page.getByRole('button', { name: 'Vezi satelit', exact: true }).click();
	await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
	await expect(page.locator('.leaflet-control-attribution')).toContainText('Esri');
	await expect(page.locator('.leaflet-control-attribution')).not.toContainText('CARTO');
	await page.getByRole('button', { name: 'Înapoi la harta stradală', exact: true }).click();
	await expect(page.locator('.leaflet-control-attribution')).toContainText('CARTO');
	await expect(page.locator('.leaflet-control-attribution')).not.toContainText('Esri');
	expect(network.outgoing.some((url) => url.includes('server.arcgisonline.com'))).toBe(true);
});

test('theme change uses the corresponding keyed style and preserves map attribution', async ({ page, context }) => {
	const network = await tileNetwork(context);
	await openControlled(page);
	await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
	await page.getByRole('button', { name: 'Meniu', exact: true }).click();
	await page.getByRole('button', { name: 'Light theme', exact: true }).click();
	await expect.poll(() => network.outgoing.some((url) => url.includes('/light_all/'))).toBe(true);
	await expect(page.locator('.leaflet-control-attribution')).toContainText('CARTO');
	const carto = network.outgoing.filter((url) => new URL(url).hostname.endsWith('cartocdn.com'));
	expect(carto.length).toBeGreaterThan(0);
	for (const url of carto) {
		expect(new URL(url).hostname).toBe('basemaps.cartocdn.com');
		expect(new URL(url).searchParams.get('key')).toBe(TEST_KEY);
	}
});
