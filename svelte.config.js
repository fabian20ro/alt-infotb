import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const modeArg = process.argv.findIndex((arg) => arg === '--mode' || arg === '-m');
const mode = modeArg >= 0 ? process.argv[modeArg + 1]
	: process.argv.find((arg) => arg.startsWith('--mode=') || arg.startsWith('-m='))?.split('=')[1];
const output = mode === 'offline-preview' ? 'build-offline' : 'build';
const config = {
	kit: {
		files: { serviceWorker: mode === 'offline-preview' ? 'src/service-worker-offline.ts' : 'src/service-worker.ts' },
		// Registration is explicit in the root layout; avoid two competing registrars.
		serviceWorker: { register: false },
		adapter: adapter({
			pages: output,
			assets: output,
			fallback: undefined,
			precompress: false,
			strict: true
		}),
		paths: {
			base: process.argv.includes('dev') ? '' : '/alt-infotb'
		}
	}
};

export default config;
