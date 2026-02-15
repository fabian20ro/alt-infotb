import { test, expect } from '@playwright/test';

test.describe('Arrival Board', () => {
	test('displays station name and arrival rows', async ({ page }) => {
		await page.goto('/');

		// Station name is visible
		const heading = page.locator('h1');
		await expect(heading).toBeVisible();
		await expect(heading).not.toBeEmpty();

		// Wait for data to load (direction text appears only with real data)
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		// At least one tram line badge should appear
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

		// First row should have either time values or "--" no-data
		const firstRow = rows.first();
		const timesContainer = firstRow.locator('.times');
		await expect(timesContainer).toBeVisible();
	});

	test('last-updated timestamp is shown', async ({ page }) => {
		await page.goto('/');

		// Wait for data to load
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		// Footer should show "actualizat" with time
		const footer = page.locator('.board-footer');
		await expect(footer).toBeVisible();
		await expect(footer).toContainText('actualizat');
	});

	test('refresh button triggers data reload', async ({ page }) => {
		await page.goto('/');

		// Wait for initial data to load
		const direction = page.locator('.direction').first();
		await expect(direction).toBeVisible({ timeout: 15_000 });

		// Click the refresh button in the footer
		const refreshBtn = page.locator('.board-footer button').first();
		await refreshBtn.click();

		// Board should still show data after refresh
		await expect(page.locator('.arrival-row').first()).toBeVisible();
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
