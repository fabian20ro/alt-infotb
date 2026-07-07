import { test, expect } from '@playwright/test';

test.describe('Station Arrivals', () => {
	test('displays station name and arrival rows', async ({ page }) => {
		await page.goto('/');

		// Station name is visible in header
		const heading = page.locator('.station-name');
		await expect(heading).toBeVisible();
		await expect(heading).not.toBeEmpty();

		// Wait for data to load (direction text appears only with real data)
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		// At least one line badge should appear (any transport type)
		const badges = page.locator('.line-badge');
		const count = await badges.count();
		expect(count).toBeGreaterThanOrEqual(1);
	});

	test('arrival rows show direction and time info', async ({ page }) => {
		await page.goto('/');

		// Wait for data to load
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		// Each arrival row should have a line badge and direction
		const rows = page.locator('.arrival-row');
		const count = await rows.count();
		expect(count).toBeGreaterThanOrEqual(1);

		// First row should have time values or "--" no-data
		const firstRow = rows.first();
		const timesContainer = firstRow.locator('.times');
		await expect(timesContainer).toBeVisible();
	});

	test('shows skeleton loading state before data arrives', async ({ page }) => {
		await page.goto('/');

		// Skeleton placeholders should appear during initial load
		const skeletons = page.locator('.skeleton');
		await expect(skeletons.first()).toBeVisible({ timeout: 5_000 });

		// After data loads, skeleton should be gone
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });
		await expect(skeletons.first()).not.toBeVisible();
	});

	test('recovers to normal state after transient API error', async ({ page }) => {
		let requestCount = 0;

		// Intercept and block the first request, then unblock subsequent ones
		await page.route('**/stb-api/**', async (route) => {
			requestCount += 1;
			if (requestCount === 1) {
				return route.abort();
			}
			return route.continue();
		});

		await page.goto('/');

		// Error state should appear after first blocked request
		const errorMsg = page.locator('.error-message');
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });

		const retryBtn = page.locator('.retry-btn');
		await expect(retryBtn).toBeVisible();

		// Click retry to trigger re-fetch (will succeed on 2nd request)
		await retryBtn.click();

		// Data should load after recovery — direction text appears only with real data
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		// Error state and error-message class should be gone
		await expect(errorMsg).not.toBeVisible();
	});

	test('refreshes on resume signal and continues 20s polling', async ({ page }) => {
		let stopRequests = 0;
		page.on('request', (request) => {
			if (request.url().includes('/stb-api/lines/stop?stop_id=')) {
				stopRequests += 1;
			}
		});

		await page.goto('/');

		// Wait for initial arrivals load
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		const initialCount = stopRequests;

		// Polling should run again after 20s
		await page.waitForTimeout(21_000);
		expect(stopRequests).toBeGreaterThan(initialCount);

		const beforeFocus = stopRequests;
		await page.evaluate(() => {
			window.dispatchEvent(new Event('focus'));
		});

		// Resume signal should force immediate refresh without waiting 20s
		await expect.poll(() => stopRequests).toBeGreaterThan(beforeFocus);

		const afterFocus = stopRequests;
		await page.waitForTimeout(21_000);
		expect(stopRequests).toBeGreaterThan(afterFocus);
	});

	test('shows error state when API is unreachable', async ({ page }) => {
		// Block API proxy requests
		await page.route('**/stb-api/**', (route) => route.abort());

		await page.goto('/');

		// Error message should appear
		const errorMsg = page.locator('.error-message');
		await expect(errorMsg).toBeVisible({ timeout: 15_000 });

		// Retry button should be present
		const retryBtn = page.locator('.retry-btn');
		await expect(retryBtn).toBeVisible();
	});
});

test.describe('Hamburger Drawer', () => {
	test('opens when menu button is clicked', async ({ page }) => {
		await page.goto('/');

		// Drawer should be hidden initially
		const drawer = page.locator('nav.drawer');
		await expect(drawer).not.toHaveClass(/open/);

		// Click the hamburger menu button
		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		// Drawer should be visible
		await expect(drawer).toHaveClass(/open/);

		// Should show Favorites and Recents sections
		const sections = drawer.locator('.section-title');
		await expect(sections.first()).toBeVisible();
	});

	test('closes when backdrop is clicked', async ({ page }) => {
		await page.goto('/');

		// Open drawer
		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		const drawer = page.locator('nav.drawer');
		await expect(drawer).toHaveClass(/open/);

		// Click backdrop
		const backdrop = page.locator('.backdrop');
		await backdrop.click({ force: true });

		// Drawer should close
		await expect(drawer).not.toHaveClass(/open/);
	});

	test('closes on Escape key', async ({ page }) => {
		await page.goto('/');

		// Open drawer
		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		const drawer = page.locator('nav.drawer');
		await expect(drawer).toHaveClass(/open/);

		// Press Escape
		await page.keyboard.press('Escape');

		// Drawer should close
		await expect(drawer).not.toHaveClass(/open/);
	});

	test('shows theme and language toggles', async ({ page }) => {
		await page.goto('/');

		// Open drawer
		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		const drawer = page.locator('nav.drawer');

		// Theme toggle buttons
		const toggleBtns = drawer.locator('.toggle-btn');
		const count = await toggleBtns.count();
		expect(count).toBe(4); // Light, Dark, RO, EN
	});
});

test.describe('Favorites', () => {
	test('favorite button toggles state', async ({ page }) => {
		await page.goto('/');

		// Wait for data
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		// Click favorite button
		const favBtn = page.locator('.fav-btn');
		await expect(favBtn).toBeVisible();

		// Toggle favorite on
		await favBtn.click();
		await expect(favBtn).toHaveClass(/active/);

		// Toggle favorite off
		await favBtn.click();
		await expect(favBtn).not.toHaveClass(/active/);
	});

	test('favorited station appears in drawer', async ({ page }) => {
		await page.goto('/');

		// Wait for data
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		// Get station name
		const stationName = await page.locator('.station-name').textContent();

		// Favorite the station
		const favBtn = page.locator('.fav-btn');
		await favBtn.click();
		await expect(favBtn).toHaveClass(/active/);

		// Open drawer
		const menuBtn = page.getByRole('button', { name: 'Meniu' });
		await menuBtn.click();

		// Station should appear in favorites section
		const drawer = page.locator('nav.drawer');
		const favStation = drawer.locator('.station-item-name').first();
		await expect(favStation).toHaveText(stationName!);

		// Clean up: remove favorite
		await page.keyboard.press('Escape');
		await favBtn.click();
	});
});

test.describe('Map', () => {
	test('map container is visible', async ({ page }) => {
		await page.goto('/');

		// Map wrapper should be visible
		const mapWrapper = page.locator('.map-wrapper');
		await expect(mapWrapper).toBeVisible();

		// Map container should exist
		const mapContainer = page.locator('.map-container');
		await expect(mapContainer).toBeVisible();
	});

	test('map loads Leaflet', async ({ page }) => {
		await page.goto('/');

		// Wait for Leaflet to load (it creates a .leaflet-container element)
		const leafletContainer = page.locator('.leaflet-container');
		await expect(leafletContainer).toBeVisible({ timeout: 10_000 });
	});
});

test.describe('Layout', () => {
	test('has split layout with arrivals panel and map', async ({ page }) => {
		await page.goto('/');

		// Main app layout
		const layout = page.locator('.app-layout');
		await expect(layout).toBeVisible();

		// Arrivals panel on top
		const arrivalsPanel = page.locator('.arrivals-panel');
		await expect(arrivalsPanel).toBeVisible();

		// Map on bottom
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
