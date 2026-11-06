import { expect, test } from '@playwright/test';
import { PLACES } from '../src/profile.ts';

interface Scenario { place: string; zoom: number; theme: string; pixelRatio: number; features: number; symbols: number; idleMs: number }
interface Harness {
	state: { ready: boolean; errors: string[]; manifestSha256: string; downloadedBytes: number; downloadedFiles: number };
	scenario(place: string, zoom: number, theme: 'light' | 'dark'): Promise<Scenario>;
}
declare global { interface Window { pmtilesHarness: Harness } }

test('complete package renders every locality/theme/zoom using only verified memory bytes', async ({ page, context, baseURL }, testInfo) => {
	const errors: string[] = [];
	const external: string[] = [];
	const offlineRequests: string[] = [];
	let offline = false;
	const origin = new URL(baseURL!).origin;
	page.on('pageerror', error => errors.push(error.message));
	context.on('request', request => { if (offline && /^https?:/.test(request.url())) offlineRequests.push(request.url()); });
	await page.route('**/*', route => {
		if (new URL(route.request().url()).origin !== origin) { external.push(new URL(route.request().url()).origin); return route.abort(); }
		return route.continue();
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'Descarcă și verifică pachetul' }).click();
	await page.waitForFunction(() => window.pmtilesHarness.state.ready || window.pmtilesHarness.state.errors.length > 0, undefined, { timeout: 90_000 });
	expect(await page.evaluate(() => ({ ready: window.pmtilesHarness.state.ready, errors: window.pmtilesHarness.state.errors }))).toEqual({ ready: true, errors: [] });
	const installed = await page.evaluate(() => ({ manifestSha256: window.pmtilesHarness.state.manifestSha256,
		downloadedBytes: window.pmtilesHarness.state.downloadedBytes, downloadedFiles: window.pmtilesHarness.state.downloadedFiles }));
	expect(installed.downloadedBytes).toBeGreaterThan(0);
	await context.setOffline(true);
	offline = true;
	const scenarios: Scenario[] = [];
	try {
		for (const theme of ['light', 'dark'] as const) for (const place of Object.keys(PLACES)) for (const zoom of [10, 15, 18]) {
			const result = await page.evaluate(({ place, zoom, theme }) => window.pmtilesHarness.scenario(place, zoom, theme), { place, zoom, theme });
			expect(result.features, `${place}/${zoom}/${theme}: geometry`).toBeGreaterThan(0);
			if (zoom <= 15) expect(result.symbols, `${place}/${zoom}/${theme}: labels`).toBeGreaterThan(0);
			scenarios.push(result);
			if (place === 'Bucuresti' && zoom === 15) await page.locator('#map').screenshot({ path: testInfo.outputPath(`bucharest-${theme}.png`) });
		}
		expect(errors).toEqual([]);
		expect(external).toEqual([]);
		expect(offlineRequests).toEqual([]);
		expect(await page.evaluate(() => window.pmtilesHarness.state.errors)).toEqual([]);
		await testInfo.attach('pmtiles-scenarios', { contentType: 'application/json', body: JSON.stringify({ ...installed, offline: true, scenarios }) });
	} finally { offline = false; await context.setOffline(false); }
});
