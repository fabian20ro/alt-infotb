import { defineConfig, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('.offline-preview', { recursive: true });
writeFileSync('.offline-preview/build-pointer.txt', 'build-offline\n');

// Both immutable app builds are prepared before Playwright starts; never rebuild
// Svelte/Vite while a browser scenario is running. Full package bytes stay local.
export default defineConfig({
	testDir: './e2e', testMatch: 'offline-maps.spec.ts',
	fullyParallel: false, workers: 1, retries: 0, forbidOnly: !!process.env.CI,
	timeout: 180_000,
	expect: { timeout: 20_000 },
	reporter: [['list'], ['html', { outputFolder: 'playwright-report-offline', open: 'never' }]],
	outputDir: 'test-results-offline',
	use: {
		...devices['Pixel 5'], baseURL: 'http://localhost:4190/alt-infotb/',
		launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'], args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
		serviceWorkers: 'allow', trace: 'retain-on-failure', screenshot: 'only-on-failure',
		geolocation: { latitude: 44.4268, longitude: 26.1025 }, permissions: ['geolocation']
	},
	webServer: {
		command: 'node scripts/serve-offline-preview.ts',
		url: 'http://localhost:4190/__preview_health', reuseExistingServer: false,
		env: { PORT: '4190', PREVIEW_BUILD_POINTER: '.offline-preview/build-pointer.txt' }
	}
});
