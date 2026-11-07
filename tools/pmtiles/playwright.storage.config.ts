import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: './storage-browser', testMatch: '*.browser.ts', workers: 1, fullyParallel: false,
	forbidOnly: !!process.env.CI, retries: 0, timeout: 300_000, reporter: 'list', outputDir: 'out/storage-browser-results',
	use: { baseURL: 'http://localhost:4187', viewport: { width: 411, height: 784 }, deviceScaleFactor: 2,
		launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
		serviceWorkers: 'allow', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	webServer: { command: 'node src/serve-storage.ts', url: 'http://localhost:4187/config.json',
		reuseExistingServer: false, env: { PORT: '4187' }, timeout: 120_000 }
});
