import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function station(page: Page, name: string): Locator {
	// Leaflet DivIcons are buttons, not images. A station needs a real accessible name.
	return page.getByRole('button', { name, exact: true });
}

async function tapVisibleCenter(page: Page, marker: Locator) {
	await expect(marker).toBeVisible();
	const box = await marker.boundingBox();
	if (!box) throw new Error('Station has no hit target');
	const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	expect(await marker.evaluate((element, point) =>
		element.contains(document.elementFromPoint(point.x, point.y)), point)).toBe(true);
	await page.touchscreen.tap(point.x, point.y);
}

test.beforeEach(async ({ page, baseURL }) => {
	const origin = new URL(baseURL!).origin;
	await page.route('**/*', (route) => new URL(route.request().url()).origin === origin
		? route.continue() : route.abort());
	await page.route('**/e2e/fixtures/map-touch.html*', async (route) => route.fulfill({
		contentType: 'text/html', body: await readFile(new URL('./fixtures/map-touch.html', import.meta.url), 'utf8')
	}));
	await page.route('**/*.png', (route) => route.fulfill({
		contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'
	}));
	await page.goto('/e2e/fixtures/map-touch.html');
	await expect(page.locator('.station-marker').first()).toBeVisible();
});

test('nearby station centers stay tappable through the user dot and overlapping label', async ({ page, isMobile }, testInfo) => {
	test.skip(!isMobile, 'Actual touch hit testing');
	const a = station(page, 'Stația A cu un nume foarte lung');
	const b = station(page, 'Stația B');
	await tapVisibleCenter(page, a);
	await testInfo.attach('label-hit-evidence', {
		contentType: 'application/json',
		body: JSON.stringify(await page.locator('.leaflet-tooltip').evaluateAll((labels) => labels.map((label) => ({
			html: label.outerHTML, display: getComputedStyle(label).display, pointerEvents: getComputedStyle(label).pointerEvents
		}))))
	});
	await page.screenshot({ path: testInfo.outputPath('station-overlap.png') });
	await tapVisibleCenter(page, b);
	await tapVisibleCenter(page, a);
	await expect(page.getByLabel('Selected station IDs')).toHaveText('1,2,1');
});

test('vertically overlapping marker boxes preserve both visible center targets', async ({ page, isMobile }) => {
	test.skip(!isMobile, 'Actual touch hit testing');
	await page.goto('/e2e/fixtures/map-touch.html?close');
	const a = station(page, 'Stația A cu un nume foarte lung');
	const b = station(page, 'Stația B');
	await expect(a).toBeVisible();
	const aBox = (await a.boundingBox())!;
	const bBox = (await b.boundingBox())!;
	expect(bBox.y + bBox.height).toBeGreaterThan(aBox.y);
	for (const target of [a, b, a]) await tapVisibleCenter(page, target);
	await expect(page.getByLabel('Selected station IDs')).toHaveText('1,2,1');
});

test('touch station selection never leaves a floating name covering nearby stations', async ({ page, isMobile }, testInfo) => {
	test.skip(!isMobile, 'Touch-specific behavior');
	const a = station(page, 'Stația A cu un nume foarte lung');
	const b = station(page, 'Stația B');
	for (const [target, name] of [[a, 'Stația A cu un nume foarte lung'], [b, 'Stația B'], [a, 'Stația A cu un nume foarte lung']] as const) {
		await tapVisibleCenter(page, target);
		await expect(page.locator('h1')).toHaveText(name);
		await expect(page.locator('.leaflet-tooltip:visible')).toHaveCount(0);
	}
	await expect(page.getByLabel('Selected station IDs')).toHaveText('1,2,1');
	await page.getByRole('button', { name: 'Theme', exact: true }).click();
	await page.getByRole('button', { name: 'Reload stations' }).click();
	const oldX = (await a.boundingBox())!.x;
	await page.locator('.map-container').focus();
	await page.locator('.map-container').press('ArrowRight');
	await expect.poll(async () => (await a.boundingBox())!.x).not.toBe(oldX);
	await page.getByRole('button', { name: 'Zoom in' }).click();
	await expect(page.locator('.leaflet-zoom-anim')).toHaveCount(0);
	await tapVisibleCenter(page, b);
	await tapVisibleCenter(page, a);
	await expect(page.getByLabel('Selected station IDs')).toHaveText('1,2,1,2,1');
	await expect(page.locator('.leaflet-tooltip:visible')).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath('mobile-stations.png') });
});

test('desktop station labels are click-through and keyboard names survive icon replacement', async ({ page, isMobile }) => {
	test.skip(isMobile, 'Desktop hover and keyboard behavior');
	const a = station(page, 'Stația A cu un nume foarte lung');
	const b = station(page, 'Stația B');
	await a.hover();
	const tooltip = page.locator('.leaflet-tooltip');
	await expect(tooltip).toBeVisible();
	expect(await tooltip.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
	const labelBox = await tooltip.boundingBox();
	const bBox = await b.boundingBox();
	expect(labelBox && bBox).toBeTruthy();
	// The second station really lies underneath the first station's label.
	expect(bBox!.y + bBox!.height / 2).toBeGreaterThan(labelBox!.y);
	expect(bBox!.y + bBox!.height / 2).toBeLessThan(labelBox!.y + labelBox!.height);
	await b.click();
	await expect(page.locator('h1')).toHaveText('Stația B');
	await a.focus();
	await a.press('Enter');
	await expect(page.locator('h1')).toHaveText('Stația A cu un nume foarte lung');
	await b.focus();
	await b.press('Space');
	await expect(page.getByLabel('Selected station IDs')).toHaveText('2,1,2');
});
