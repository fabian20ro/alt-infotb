import { defineConfig, devices } from '@playwright/test';

// Build first with VITE_CARTO_API_KEY=pwa-regression-test-key. For missing-key
// coverage, build with an empty key and run with PWA_TEST_NO_KEY=1. These tests
// exercise the actual production worker, not the dev server.
export default defineConfig({
	testDir: './e2e',
	testMatch: process.env.PWA_TEST_NO_KEY === '1' ? 'map-no-key.spec.ts' : 'map-cache.spec.ts',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	timeout: 45_000,
	reporter: [['list'], ['html', { outputFolder: 'playwright-report-pwa', open: 'never' }]],
	outputDir: 'test-results-pwa',
	use: {
		baseURL: 'http://localhost:4173/alt-infotb/',
		serviceWorkers: 'allow',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		geolocation: { latitude: 44.4268, longitude: 26.1025 },
		permissions: ['geolocation']
	},
	projects: [
		{ name: 'PWA Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
		{ name: 'PWA Mobile Chrome', use: { ...devices['Pixel 5'] } }
	],
	webServer: {
		command: 'npm run preview -- --host localhost --port 4173 --strictPort',
		url: 'http://localhost:4173/alt-infotb/',
		reuseExistingServer: false
	}
});
