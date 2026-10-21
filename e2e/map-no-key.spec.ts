import { test, expect } from '@playwright/test';
import { syntheticMapTile } from './fixtures/map-tile';

test('missing build key keeps stations visible without CARTO requests and offers satellite', async ({ page, context }, testInfo) => {
	const cartoRequests: string[] = [];
	const tile = syntheticMapTile();
	await context.route('**/*', async (route) => {
		const url = new URL(route.request().url());
		if (url.hostname === 'localhost') return route.continue();
		if (url.hostname === 'basemaps.cartocdn.com') {
			cartoRequests.push(url.href);
			return route.abort();
		}
		return route.fulfill({
			status: 200,
			headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' },
			contentType: url.hostname === 'server.arcgisonline.com' ? 'image/png' : 'application/octet-stream',
			body: url.hostname === 'server.arcgisonline.com' ? tile : Buffer.alloc(0)
		});
	});
	await page.goto('/alt-infotb/');
	await expect(page.getByTestId('tile-status')).toContainText('Harta stradală nu este configurată');
	await expect(page.locator('.station-marker').first()).toBeVisible();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	expect(cartoRequests).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath('missing-key.png') });
	await page.getByRole('button', { name: 'Vezi satelit', exact: true }).click();
	await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
	await expect(page.locator('.leaflet-control-attribution')).toContainText('Esri');
	await expect(page.locator('.leaflet-control-attribution')).not.toContainText('CARTO');
	await page.getByRole('button', { name: 'Înapoi la harta stradală', exact: true }).click();
	await expect(page.getByTestId('tile-status')).toContainText('Harta stradală nu este configurată');
	expect(cartoRequests).toEqual([]);
});
