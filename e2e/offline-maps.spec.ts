import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { translations } from '../src/lib/i18n/translations';
import type { Journal } from '../src/lib/offline-maps/contracts';
import { syntheticMapTile } from './fixtures/map-tile';

const APP = 'http://localhost:4190/alt-infotb/';
const ro = translations.ro, en = translations.en;
const tile = syntheticMapTile();
const errorsByContext = new WeakMap<BrowserContext, string[]>();
function captureErrors(context: BrowserContext) {
	const errors: string[] = [];
	const observe = (page: Page) => page.on('pageerror', error => errors.push(error.message));
	for (const page of context.pages()) observe(page);
	context.on('page', observe); errorsByContext.set(context, errors); return errors;
}
const panel = (page: Page) => page.getByTestId('offline-maps-panel');
const packageStatus = (page: Page) => page.getByTestId('offline-package-status');
const mapStatus = (page: Page) => page.getByTestId('offline-map-status');
const build = (name: 'build-offline' | 'build-offline-next') => writeFile('.offline-preview/build-pointer.txt', `${name}\n`);

async function network(context: BrowserContext) {
	const downloads: string[] = [];
	await context.route('**/*', async route => {
		const url = new URL(route.request().url());
		if (url.hostname === 'localhost') {
			if (url.pathname.includes('/__offline_downloads__/')) downloads.push(url.pathname);
			return route.continue();
		}
		if (url.hostname.endsWith('cartocdn.com') || url.hostname.endsWith('arcgisonline.com')) {
			return route.fulfill({ status: 200, contentType: 'image/png', body: tile,
				headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=604800' } });
		}
		// Live transit is intentionally unavailable; it must remain independent of the downloaded background.
		return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '' });
	});
	return { downloads };
}
async function open(page: Page) {
	await page.goto(APP);
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
	await expect(mapStatus(page)).toHaveAttribute('data-source', /online|offline/);
}
async function openPanel(page: Page, lang: 'ro' | 'en' = 'ro') {
	if (!await panel(page).isVisible()) {
		await page.getByRole('button', { name: 'Meniu', exact: true }).click();
		await page.getByRole('button', { name: translations[lang].offlineMaps, exact: true }).click();
	}
	await expect(panel(page)).toBeVisible();
	await expect(packageStatus(page)).not.toHaveAttribute('data-availability', 'unknown');
}
async function closePanel(page: Page, lang: 'ro' | 'en' = 'ro') {
	await panel(page).getByRole('button', { name: translations[lang].close, exact: true }).click();
	await expect(panel(page)).not.toBeVisible();
}
async function install(page: Page, lang: 'ro' | 'en' = 'ro') {
	await openPanel(page, lang);
	const button = panel(page).getByRole('button', { name: translations[lang].offlineDownload, exact: true });
	await expect(button).toBeEnabled(); await button.click();
	await expect(packageStatus(page)).toHaveText(translations[lang].offlineAwaitingRender, { timeout: 150_000 });
	await expect(packageStatus(page)).toHaveAttribute('data-operation', 'idle');
}
async function useOffline(page: Page, lang: 'ro' | 'en' = 'ro') {
	await panel(page).getByRole('button', { name: translations[lang].offlineUse, exact: true }).click();
	await expect(mapStatus(page)).toHaveAttribute('data-source', 'offline');
	await expect(mapStatus(page)).toHaveAttribute('data-renderer-status', 'ready', { timeout: 45_000 });
	await expect.poll(async () => (await journal(page))?.pendingRender).toBe(false);
}
async function journal(page: Page): Promise<Journal | null> {
	return page.evaluate(async () => {
		const database = (await indexedDB.databases()).find(db => db.name?.startsWith('alt-infotb-offline-v1:') && db.name.endsWith(':bucuresti-ilfov'));
		if (!database?.name) return null;
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(database.name!);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const db = request.result; const tx = db.transaction('journal');
				const read = tx.objectStore('journal').get('region');
				read.onsuccess = () => resolve(read.result ?? null);
				tx.oncomplete = () => db.close(); tx.onerror = () => reject(tx.error);
			};
		});
	});
}
async function shellVersion(page: Page) {
	return page.evaluate(() => new Promise<{ version: string; complete: boolean }>((resolve, reject) => {
		const channel = new MessageChannel(); const timeout = setTimeout(() => reject(new Error('No shell reply')), 10_000);
		channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
		navigator.serviceWorker.controller!.postMessage({ type: 'OFFLINE_SHELL_STATUS' }, [channel.port2]);
	}));
}
async function waitForUpdate(page: Page) {
	await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
	await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting)).toBe(true);
}

test.beforeEach(async ({ context }) => { await build('build-offline'); captureErrors(context); });
test.afterEach(async ({ context }) => { await build('build-offline'); expect(errorsByContext.get(context) ?? [], 'Unexpected browser exceptions').toEqual([]); });

test('RO/EN dialog, cancellation, denied persistence, explicit use, offline reload and exact deletion', async ({ page, context }, testInfo) => {
	await context.addInitScript(() => {
		Object.defineProperty(navigator.storage, 'persisted', { value: async () => false });
		Object.defineProperty(navigator.storage, 'persist', { value: async () => false });
	});
	const net = await network(context); await open(page);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.getByRole('button', { name: 'Adaugă la favorite', exact: true }).click();
	const favorite = await page.evaluate(() => localStorage.getItem('alt-stb-favorites'));
	expect(favorite).not.toBeNull();
	expect(JSON.parse(favorite!)).toEqual([expect.objectContaining({ id: expect.any(Number), name: expect.any(String) })]);
	await page.evaluate(async () => { await (await caches.open('unrelated-map-cache')).put('/unrelated.png', new Response('retain me')); });
	await openPanel(page);
	await expect(panel(page)).toHaveAttribute('open', '');
	await expect(panel(page).getByRole('heading', { name: ro.offlineMaps })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('panel-dark.png') });
	await page.keyboard.press('Escape'); await expect(panel(page)).not.toBeVisible();
	await page.getByRole('button', { name: 'Meniu', exact: true }).click();
	await page.getByRole('button', { name: 'English', exact: true }).click();
	await page.getByRole('button', { name: 'Light theme', exact: true }).click();
	await page.getByRole('button', { name: en.offlineMaps, exact: true }).click();
	await expect(panel(page).getByRole('heading', { name: en.offlineMaps })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await page.screenshot({ path: testInfo.outputPath('panel-light.png') });
	await expect(panel(page).getByRole('button', { name: en.offlineDownload, exact: true })).toBeEnabled();
	let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
	await context.route('**/__offline_downloads__/**/*.pmtiles', async route => { await held; await route.continue().catch(() => {}); });
	await panel(page).getByRole('button', { name: en.offlineDownload, exact: true }).click();
	await expect(packageStatus(page)).toHaveAttribute('data-operation', 'downloading');
	await panel(page).getByRole('button', { name: en.offlineCancel, exact: true }).click();
	await expect(packageStatus(page)).toHaveAttribute('data-operation', 'idle');
	await expect(packageStatus(page)).toHaveAttribute('data-availability', 'absent');
	release(); await context.unroute('**/__offline_downloads__/**/*.pmtiles');
	await panel(page).getByRole('button', { name: en.offlinePersistenceRequest, exact: true }).click();
	await expect(page.getByTestId('offline-persistence')).toHaveAttribute('data-persistence', 'not-granted');
	await page.evaluate(() => {
		const event = new Event('beforeinstallprompt', { cancelable: true });
		Object.assign(event, {
			prompt: async () => { (window as any).installHadUserActivation = navigator.userActivation.isActive; },
			userChoice: Promise.resolve({ outcome: 'accepted' })
		});
		window.dispatchEvent(event);
	});
	await panel(page).getByRole('button', { name: en.offlineInstall, exact: true }).click();
	expect(await page.evaluate(() => (window as any).installHadUserActivation)).toBe(true);
	await expect(page.getByTestId('offline-persistence')).toHaveAttribute('data-persistence', 'not-granted');
	await install(page, 'en');
	await expect(mapStatus(page)).toHaveAttribute('data-source', 'online');
	expect((await journal(page))?.pendingRender).toBe(true);
	await useOffline(page, 'en'); const generation = (await journal(page))!.active!.id;
	await closePanel(page, 'en');
	// Force a real station marker over each native control using their observed
	// rectangles. Hit testing must still choose the control, not the marker.
	const overlapHits = await page.evaluate(() => {
		const attribution = document.querySelector<HTMLDetailsElement>('.maplibregl-ctrl-attrib')!;
		const wasOpen = attribution.open; attribution.open = true;
		const attributionStyle = attribution.getAttribute('style');
		const marker = document.querySelector<HTMLElement>('.maplibre-station.station-marker-selected')
			?? document.querySelector<HTMLElement>('.maplibre-station')!;
		const originalStyle = marker.getAttribute('style');
		try {
			return ['.maplibregl-ctrl-zoom-in', '.maplibregl-ctrl-attrib-inner a'].map(selector => {
				if (originalStyle === null) marker.removeAttribute('style'); else marker.setAttribute('style', originalStyle);
				const target = document.querySelector<HTMLElement>(selector)!;
				if (selector.includes('attrib')) {
					// Exercise an inline link split across lines, independent of host fonts.
					attribution.style.width = '150px'; attribution.style.maxWidth = '150px';
				}
				const fragments = [...target.getClientRects()];
				// An inline link's bounding-box center can be whitespace between lines.
				// Select a real visible fragment, never search for a point that already hits.
				const bounds = fragments.find(rect => rect.width > 0 && rect.height > 0 && rect.left >= 0
					&& rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight);
				if (!bounds) throw new Error(`No visible control fragment: ${selector}`);
				const before = marker.getBoundingClientRect();
				const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
				marker.style.transform += ` translate(${x - before.left - before.width / 2}px, ${y - before.top - before.height / 2}px)`;
				const moved = marker.getBoundingClientRect();
				const hit = document.elementFromPoint(x, y);
				return { selector, wrapped: fragments.length > 1, overlaps: moved.left <= x && moved.right >= x && moved.top <= y && moved.bottom >= y,
					controlWins: !!hit && (target === hit || target.contains(hit)) };
			});
		} finally {
			if (originalStyle === null) marker.removeAttribute('style'); else marker.setAttribute('style', originalStyle);
			if (attributionStyle === null) attribution.removeAttribute('style'); else attribution.setAttribute('style', attributionStyle);
			attribution.open = wasOpen;
		}
	});
	expect(overlapHits).toEqual([
		{ selector: '.maplibregl-ctrl-zoom-in', wrapped: false, overlaps: true, controlWins: true },
		{ selector: '.maplibregl-ctrl-attrib-inner a', wrapped: true, overlaps: true, controlWins: true }
	]);
	await page.screenshot({ path: testInfo.outputPath('map-light.png') });
	await page.getByRole('button', { name: 'Meniu', exact: true }).click();
	await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await expect(mapStatus(page)).toHaveAttribute('data-renderer-status', 'ready');
	await page.screenshot({ path: testInfo.outputPath('map-dark.png') });
	const before = net.downloads.length; await context.setOffline(true); await page.reload();
	await expect(mapStatus(page)).toHaveAttribute('data-source', 'offline');
	await expect(mapStatus(page)).toHaveAttribute('data-renderer-status', 'ready');
	await expect(page.locator('.station-marker').first()).toBeVisible();
	expect(net.downloads.length).toBe(before);
	await context.setGeolocation({ latitude: 44.84, longitude: 26.19 });
	await page.getByRole('button', { name: en.recenter, exact: true }).click();
	await expect(mapStatus(page)).toHaveAttribute('data-coverage', 'outside');
	await expect(page.getByText(en.offlineOutside)).toBeVisible();
	await openPanel(page, 'en'); await expect(panel(page)).toHaveAttribute('data-generation', generation);
	await expect(page.getByTestId('offline-persistence')).toHaveAttribute('data-persistence', 'not-granted');
	await panel(page).getByRole('button', { name: en.offlineRemove, exact: true }).click();
	await panel(page).getByRole('button', { name: en.offlineConfirmRemove, exact: true }).click();
	await expect(packageStatus(page)).toHaveAttribute('data-availability', 'absent');
	await expect(packageStatus(page)).toHaveAttribute('data-operation', 'idle');
	expect(await page.evaluate(() => localStorage.getItem('alt-stb-favorites'))).toBe(favorite);
	expect(await page.evaluate(async () => (await caches.match('/unrelated.png'))?.text())).toBe('retain me');
	expect(await page.evaluate(async () => (await caches.keys()).filter(name => name.includes(':generation:')))).toEqual([]);
});

test('app update waits for approval, old tab retains its shell, package update waits for explicit use', async ({ page, context }) => {
	test.setTimeout(360_000); await network(context); await open(page); await install(page); await useOffline(page);
	const first = (await journal(page))!.active!; const oldShell = await shellVersion(page);
	const oldChunk = await page.evaluate(async () => {
		const cache = await caches.open((await caches.keys()).find(name => name.startsWith('alt-infotb-preview-'))!);
		const request = (await cache.keys()).find(request => request.url.includes('/_app/immutable/nodes/2.') && request.url.endsWith('.js'))!;
		if (!request) throw new Error('Missing old page entry');
		return { url: request.url, body: await (await cache.match(request))!.text() };
	});
	await closePanel(page);
	const oldTab = await context.newPage(); await open(oldTab);
	await expect(mapStatus(oldTab)).toHaveAttribute('data-generation', first.id);
	await openPanel(oldTab);
	await build('build-offline-next'); await waitForUpdate(page);
	expect((await shellVersion(page)).version).toBe(oldShell.version);
	await openPanel(page);
	const reloaded = page.waitForEvent('load');
	await panel(page).getByRole('button', { name: ro.offlineApplyAppUpdate, exact: true }).click();
	await reloaded;
	await expect.poll(async () => (await shellVersion(page)).version).not.toBe(oldShell.version);
	await expect(mapStatus(page)).toHaveAttribute('data-generation', first.id);
	await expect(mapStatus(oldTab)).toHaveAttribute('data-generation', first.id);
	const newShell = await shellVersion(page);
	expect(await page.evaluate(async ({ url, version }) => {
		const name = (await caches.keys()).find(name => name.startsWith('alt-infotb-preview-') && name.endsWith(version))!;
		return !!await (await caches.open(name)).match(url);
	}, { url: oldChunk.url, version: newShell.version })).toBe(false);
	await context.setOffline(true);
	const oldResponse = oldTab.waitForResponse(oldChunk.url);
	expect(await oldTab.evaluate(async url => (await fetch(url, { cache: 'no-store' })).text(), oldChunk.url)).toBe(oldChunk.body);
	expect((await oldResponse).fromServiceWorker()).toBe(true);
	await context.setOffline(false);
	await openPanel(oldTab);
	await expect(panel(oldTab).getByRole('button', { name: ro.offlineApplyAppUpdate, exact: true })).toBeVisible();
	await expect(panel(oldTab).getByText(ro.offlineShellPending).first()).toBeVisible();
	await openPanel(page);
	const update = panel(page).getByRole('button', { name: ro.offlineUpdate, exact: true }); await expect(update).toBeEnabled(); await update.click();
	await expect(packageStatus(page)).toHaveText(ro.offlineAwaitingRender, { timeout: 150_000 });
	const next = (await journal(page))!;
	expect(next.active!.manifest.version).toMatch(/-v2$/); expect(next.previous?.id).toBe(first.id);
	await expect(mapStatus(page)).toHaveAttribute('data-generation', first.id);
	await useOffline(page);
	await expect(mapStatus(page)).toHaveAttribute('data-generation', next.active!.id);
	await expect(mapStatus(oldTab)).toHaveAttribute('data-generation', first.id);
	// Closing the old tab releases its reader before the exact old generation can be reclaimed.
	await oldTab.close();
	await panel(page).getByRole('button', { name: ro.offlinePersistenceCheck, exact: true }).click();
	await expect.poll(async () => (await journal(page))?.garbage.length ?? 0).toBe(0);
	expect((await journal(page))?.active?.id).toBe(next.active!.id);
	await context.setOffline(true); await page.reload();
	await expect(mapStatus(page)).toHaveAttribute('data-generation', next.active!.id);
	await expect(mapStatus(page)).toHaveAttribute('data-renderer-status', 'ready');
	// Application rollback must retain the newer compatible package and never offer a downgrade.
	await context.setOffline(false); await build('build-offline'); await waitForUpdate(page); await openPanel(page);
	const rollbackLoaded = page.waitForEvent('load');
	await panel(page).getByRole('button', { name: ro.offlineApplyAppUpdate, exact: true }).click(); await rollbackLoaded;
	await expect.poll(async () => (await shellVersion(page)).version).toBe(oldShell.version);
	await expect(mapStatus(page)).toHaveAttribute('data-generation', next.active!.id);
	await openPanel(page);
	await expect(panel(page).getByRole('button', { name: ro.offlineUpdate, exact: true })).toHaveCount(0);
	expect((await journal(page))!.active!.manifest.version).toMatch(/-v2$/);
	await context.setOffline(true); await page.reload();
	await expect(mapStatus(page)).toHaveAttribute('data-generation', next.active!.id);
	await expect(mapStatus(page)).toHaveAttribute('data-renderer-status', 'ready');
});

test('WebGL loss is recoverable; corrupted stored style requires a verified replacement', async ({ page, context }) => {
	test.setTimeout(360_000); await network(context); await open(page); await install(page); await useOffline(page);
	const first = (await journal(page))!.active!; await closePanel(page);
	const lost = await page.locator('canvas.maplibregl-canvas').evaluate((canvas: HTMLCanvasElement) => {
		const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context'); extension?.loseContext(); return !!extension;
	});
	expect(lost).toBe(true); await expect(mapStatus(page).getByText(ro.offlineContextLost)).toBeVisible();
	await openPanel(page); await panel(page).getByRole('button', { name: ro.offlineReopen, exact: true }).click();
	await expect(mapStatus(page)).toHaveAttribute('data-renderer-status', 'ready'); expect((await journal(page))!.active!.id).toBe(first.id);
	await closePanel(page);
	await page.evaluate(async id => {
		const cache = await caches.open((await caches.keys()).find(name => name.endsWith(`:generation:${id}`))!);
		const entry = (await cache.keys()).find(request => request.url.endsWith('/light.json'))!; await cache.delete(entry);
	}, first.id);
	await page.getByRole('button', { name: 'Meniu', exact: true }).click();
	await page.getByRole('button', { name: 'Light theme', exact: true }).click();
	await page.getByRole('button', { name: ro.offlineMaps, exact: true }).click();
	await expect(packageStatus(page)).toHaveAttribute('data-availability', 'damaged');
	await panel(page).getByRole('button', { name: ro.offlineRepair, exact: true }).click();
	// The invalid prior reader may keep cleanup pending until the replacement is used.
	await expect(panel(page).getByRole('button', { name: ro.offlineUse, exact: true })).toBeEnabled({ timeout: 150_000 });
	expect((await journal(page))?.pendingRender).toBe(true);
	await useOffline(page);
	const repaired = (await journal(page))!.active!;
	expect(repaired.id).not.toBe(first.id); expect(repaired.manifestSha256).toBe(first.manifestSha256);
});

test('missing cached shell chunk blocks package activation; app update cannot bypass another tab operation lock', async ({ page, context }) => {
	await network(context); await open(page); await openPanel(page);
	await expect(panel(page).getByRole('button', { name: ro.offlineDownload, exact: true })).toBeEnabled();
	await page.evaluate(async () => {
		const cache = await caches.open((await caches.keys()).find(name => name.startsWith('alt-infotb-preview-'))!);
		const request = (await cache.keys()).find(request => request.url.includes('/_app/immutable/') && request.url.endsWith('.js'))!;
		if (!request) throw new Error('No cached chunk'); await cache.delete(request);
	});
	await panel(page).getByRole('button', { name: ro.offlinePersistenceCheck, exact: true }).click();
	await expect(panel(page).getByRole('button', { name: ro.offlineDownload, exact: true })).toBeDisabled();
	await build('build-offline-next'); await waitForUpdate(page);
	const lockTab = await context.newPage(); await lockTab.goto(APP);
	await lockTab.evaluate(() => { Object.assign(window, { releasePreviewLock: null }); void navigator.locks.request(`offline-shell:${location.origin}/alt-infotb/:transition`, { mode: 'shared' }, () => new Promise<void>(resolve => { (window as any).releasePreviewLock = resolve; })); });
	await expect.poll(() => lockTab.evaluate(() => typeof (window as any).releasePreviewLock)).toBe('function');
	const old = (await shellVersion(page)).version;
	await panel(page).getByRole('button', { name: ro.offlineApplyAppUpdate, exact: true }).click();
	await expect(panel(page).getByText(ro.offlineAppUpdateBusy)).toBeVisible();
	expect((await shellVersion(page)).version).toBe(old);
	await lockTab.evaluate(() => (window as any).releasePreviewLock()); await lockTab.close();
	const reloaded = page.waitForEvent('load');
	await panel(page).getByRole('button', { name: ro.offlineApplyAppUpdate, exact: true }).click();
	await reloaded;
	await expect.poll(async () => (await shellVersion(page)).version).not.toBe(old);
});

test('fresh Chromium process reopens the complete app and package offline', async () => {
	test.setTimeout(240_000); const profile = await mkdtemp(path.join(tmpdir(), 'alt-infotb-offline-app-'));
	let context: BrowserContext | undefined;
	const browserErrors: string[] = [];
	try {
		context = await chromium.launchPersistentContext(profile, { headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: 393, height: 851 }, geolocation: { latitude: 44.4268, longitude: 26.1025 }, permissions: ['geolocation'] });
		const firstErrors = captureErrors(context);
		await network(context); let page = context.pages()[0]; await open(page); await install(page); await useOffline(page);
		const active = (await journal(page))!.active!.id; await context.close(); browserErrors.push(...firstErrors);
		context = await chromium.launchPersistentContext(profile, { headless: true, offline: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], viewport: { width: 393, height: 851 }, geolocation: { latitude: 44.4268, longitude: 26.1025 }, permissions: ['geolocation'] });
		const secondErrors = captureErrors(context);
		page = context.pages()[0]; await page.goto(APP);
		await expect(mapStatus(page)).toHaveAttribute('data-generation', active);
		await expect(mapStatus(page)).toHaveAttribute('data-renderer-status', 'ready');
		await expect(page.locator('.station-marker').first()).toBeVisible();
		expect(await page.evaluate(async () => { try { await fetch('/__preview_health'); return true; } catch { return false; } })).toBe(false);
		expect((await shellVersion(page)).complete).toBe(true);
		browserErrors.push(...secondErrors); expect(browserErrors).toEqual([]);
	} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
