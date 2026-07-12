import { test, expect } from '@playwright/test';

test.describe('Station Arrivals', () => {
	test('displays station name and arrival rows', async ({ page }) => {
		await page.goto('/');

		const heading = page.locator('.station-name');
		await expect(heading).toBeVisible();
		await expect(heading).not.toBeEmpty();

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		const badges = page.locator('.line-badge');
		const count = await badges.count();
		expect(count).toBeGreaterThanOrEqual(1);
	});

	test('arrival rows render non-empty line names in badges', async ({ page }) => {
		await page.goto('/');

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		const rows = page.locator('.arrival-row');
		const count = await rows.count();
		expect(count).toBeGreaterThanOrEqual(1);

		for (let i = 0; i < count; i++) {
			const row = rows.nth(i);
			const badge = row.locator('.line-badge');
			await expect(badge).toBeVisible();
			const text = await badge.textContent();
			expect(text.length).toBeGreaterThan(0);
		}
	});

	test('arrival rows show direction and time info', async ({ page }) => {
		await page.goto('/');

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		const rows = page.locator('.arrival-row');
		const count = await rows.count();
		expect(count).toBeGreaterThanOrEqual(1);

		const firstRow = rows.first();
		const timesContainer = firstRow.locator('.times');
		await expect(timesContainer).toBeVisible();
	});

	test('all arrival rows render non-empty departure time text', async ({ page }) => {
		await page.goto('/');

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		const rows = page.locator('.arrival-row');
		const count = await rows.count();
		expect(count).toBeGreaterThanOrEqual(1);

		for (let i = 0; i < count; i++) {
			const row = rows.nth(i);
			const timesContainer = row.locator('.times');
			await expect(timesContainer).toBeVisible();
			const text = await timesContainer.textContent();
			expect(text!.length).toBeGreaterThan(0);
		}
	});

	test('shows skeleton loading state before data arrives', async ({ page }) => {
		await page.goto('/');

		const skeletons = page.locator('.skeleton');
		await expect(skeletons.first()).toBeVisible({ timeout: 5_000 });

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });
		await expect(skeletons.first()).not.toBeVisible();
	});

	test('recovers to normal state after transient API error', async ({ page }) => {
		let requestCount = 0;

		await page.route('**/stb-api/**', async (route) => {
			requestCount += 1;
			if (requestCount === 1) {
				return route.abort();
			}
			return route.continue();
		});

		await page.goto('/');

		const errorMsg = page.locator('.error-message');
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });

		const retryBtn = page.locator('.retry-btn');
		await expect(retryBtn).toBeVisible();

		await retryBtn.click();

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		await expect(errorMsg).not.toBeVisible();
	});

	test('handles consecutive API failures before eventual recovery', async ({ page }) => {
		let requestCount = 0;

		await page.route('**/stb-api/**', async (route) => {
			requestCount += 1;
			if (requestCount <= 3) {
				return route.abort();
			}
			return route.continue();
		});

		await page.goto('/');

		const errorMsg = page.locator('.error-message');
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });

		const retryBtn = page.locator('.retry-btn');
		await expect(retryBtn).toBeVisible();

		await retryBtn.click();

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 20_000 });

		await expect(errorMsg).not.toBeVisible();

		for (let i = 0; i < (await page.locator('.arrival-row').count()); i++) {
			const row = page.locator('.arrival-row').nth(i);
			const badge = row.locator('.line-badge');
			await expect(badge).toBeVisible();
			const text = await badge.textContent();
			expect(text!.length).toBeGreaterThan(0);
		}
	});

	test('refreshes on resume signal and continues 20s polling', async ({ page }) => {
		let stopRequests = 0;
		page.on('request', (request) => {
			if (request.url().includes('/stb-api/lines/stop?stop_id=')) {
				stopRequests += 1;
			}
		});

		await page.goto('/');

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		const initialCount = stopRequests;

		await page.waitForTimeout(21_000);
		expect(stopRequests).toBeGreaterThan(initialCount);

		const beforeFocus = stopRequests;
		await page.evaluate(() => {
			window.dispatchEvent(new Event('focus'));
		});

		await expect.poll(() => stopRequests).toBeGreaterThan(beforeFocus);

		const afterFocus = stopRequests;
		await page.waitForTimeout(21_000);
		expect(stopRequests).toBeGreaterThan(afterFocus);
	});

	test('polling causes arrival rows to re-render on successful refresh', async ({ page }) => {
		await page.goto('/');

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		const rowsBefore = page.locator('.arrival-row');
		const countBefore = await rowsBefore.count();
		expect(countBefore).toBeGreaterThanOrEqual(1);

		await page.evaluate(() => {
			window.dispatchEvent(new Event('focus'));
		});

		const directionAfter = page.locator('.direction').first();
		await expect(directionAfter).toBeVisible({ timeout: 15_000 });

		const rowsAfter = page.locator('.arrival-row');
		const countAfter = await rowsAfter.count();
		expect(countAfter).toBeGreaterThanOrEqual(1);

		for (let i = 0; i < countAfter; i++) {
			const row = rowsAfter.nth(i);
			const badge = row.locator('.line-badge');
			await expect(badge).toBeVisible();
			const text = await badge.textContent();
			expect(text!.length).toBeGreaterThan(0);
		}
	});

	test('shows error state when API is unreachable', async ({ page }) => {
		await page.route('**/stb-api/**', (route) => route.abort());

		await page.goto('/');

		const errorMsg = page.locator('.error-message');
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });

		const retryBtn = page.locator('.retry-btn');
		await expect(retryBtn).toBeVisible();
	});

	test('sets normalized error message when API rejects with non-Error value', async ({ page }) => {
		await page.route('**/stb-api/**', (route) => route.abort());

		await page.goto('/');

		const errorMsg = page.locator('.error-message');
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });

		const text = await errorMsg.textContent();
		expect(text!.length).toBeGreaterThan(0);
	});
});

test.describe('Hamburger Drawer', () => {
	test('opens when menu button is clicked', async ({ page }) => {
		await page.goto('/');

		const drawer = page.locator('nav.drawer');
		await expect(drawer).not.toHaveClass(/open/);

		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		await expect(drawer).toHaveClass(/open/);

		const sections = drawer.locator('.section-title');
		await expect(sections.first()).toBeVisible();
	});

	test('closes when backdrop is clicked', async ({ page }) => {
		await page.goto('/');

		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		const drawer = page.locator('nav.drawer');
		await expect(drawer).toHaveClass(/open/);

		const backdrop = page.locator('.backdrop');
		await backdrop.click({ force: true });

		await expect(drawer).not.toHaveClass(/open/);
	});

	test('closes on Escape key', async ({ page }) => {
		await page.goto('/');

		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		const drawer = page.locator('nav.drawer');
		await expect(drawer).toHaveClass(/open/);

		await page.keyboard.press('Escape');

		await expect(drawer).not.toHaveClass(/open/);
	});

	test('shows theme and language toggles', async ({ page }) => {
		await page.goto('/');

		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		const drawer = page.locator('nav.drawer');

		const toggleBtns = drawer.locator('.toggle-btn');
		const count = await toggleBtns.count();
		expect(count).toBe(4);
	});
});

test.describe('Favorites', () => {
	test('favorite button toggles state', async ({ page }) => {
		await page.goto('/');

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		const favBtn = page.locator('.fav-btn');
		await expect(favBtn).toBeVisible();

		await favBtn.click();
		await expect(favBtn).toHaveClass(/active/);

		await favBtn.click();
		await expect(favBtn).not.toHaveClass(/active/);
	});

	test('favorited station appears in drawer', async ({ page }) => {
		await page.goto('/');

		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		const stationName = await page.locator('.station-name').textContent();

		const favBtn = page.locator('.fav-btn');
		await favBtn.click();
		await expect(favBtn).toHaveClass(/active/);

		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		const drawer = page.locator('nav.drawer');
		const favStation = drawer.locator('.station-item-name').first();
		await expect(favStation).toHaveText(stationName!);

		await page.keyboard.press('Escape');
		await favBtn.click();
	});
});

test.describe('Map', () => {
	test('map container is visible', async ({ page }) => {
		await page.goto('/');

		const mapWrapper = page.locator('.map-wrapper');
		await expect(mapWrapper).toBeVisible();

		const mapContainer = page.locator('.map-container');
		await expect(mapContainer).toBeVisible();
	});

	test('map loads Leaflet', async ({ page }) => {
		await page.goto('/');

		const leafletContainer = page.locator('.leaflet-container');
		await expect(leafletContainer).toBeVisible({ timeout: 10_000 });
	});
});

test.describe('Layout', () => {
	test('has split layout with arrivals panel and map', async ({ page }) => {
		await page.goto('/');

		const layout = page.locator('.app-layout');
		await expect(layout).toBeVisible();

		const arrivalsPanel = page.locator('.arrivals-panel');
		await expect(arrivalsPanel).toBeVisible();

		const mapWrapper = page.locator('.map-wrapper');
		await expect(mapWrapper).toBeVisible();
	});

	test('station header has menu and favorite buttons', async ({ page }) => {
		await page.goto('/');

		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await expect(menuBtn).toBeVisible();

		const favBtn = page.locator('.fav-btn');
		await expect(favBtn).toBeVisible();

		const stationName = page.locator('.station-name');
		await expect(stationName).toBeVisible();
	});
});