import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './browser', testMatch: 'package.spec.ts', workers: 1, fullyParallel: false,
	forbidOnly: !!process.env.CI, retries: 0, timeout: 180_000,
	reporter: [['list'], ['./browser/receipt-reporter.ts']],
	outputDir: 'out/browser-results',
	use: { baseURL: 'http://localhost:4186', viewport: { width: 411, height: 784 },
		launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
		serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	projects: [
		{ name: 'DPR 1', use: { browserName: 'chromium', deviceScaleFactor: 1 } },
		{ name: 'DPR 2', use: { browserName: 'chromium', deviceScaleFactor: 2 } }
	],
	webServer: { command: 'node src/serve.ts', url: 'http://localhost:4186/config.json', reuseExistingServer: false,
		env: { PORT: '4186' }, timeout: 30_000 }
});
