import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
	testDir:'./e2e',testMatch:'map-parity.spec.ts',workers:1,fullyParallel:false,forbidOnly:!!process.env.CI,
	retries:0,timeout:60_000,reporter:'list',outputDir:'test-results/map-parity',
	use:{baseURL:'http://localhost:5189',trace:'retain-on-failure',screenshot:'only-on-failure',
		launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
	projects:[{name:'Parity Desktop Chromium',use:{...devices['Desktop Chrome']}},{name:'Parity Android Chromium',use:{...devices['Pixel 5']}}],
	webServer:{command:'npm run dev -- --mode test --port 5189',env:{VITE_CARTO_API_KEY:'map-parity-test-key'},url:'http://localhost:5189',reuseExistingServer:false}
});
