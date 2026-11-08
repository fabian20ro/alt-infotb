import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { createHandler } from './shared-api/src/index.js';

/** Adapt Node HTTP to the shared proxy contract; policy/auth live in one place. */
function stbProxy(appId: string | undefined, appKey: string | undefined): Plugin {
	let handle: ReturnType<typeof createHandler> | undefined;
	return {
		name: 'stb-proxy',
		configureServer(server) {
			server.middlewares.use('/stb-api', async (req, res) => {
				if (!appId || !appKey) {
					res.writeHead(503, { 'content-type': 'text/plain' });
					res.end('STB dev proxy credentials are not configured');
					return;
				}
				try {
					handle ??= createHandler(
						{ STB_APP_ID: appId, STB_APP_KEY: appKey, ALLOWED_ORIGINS: [] },
						{ clock: { now: Date.now }, logger: console }
					);
					const response = await handle(new Request(`http://localhost${req.url ?? '/'}`, {
						method: req.method,
						headers: { Origin: req.headers.origin ?? 'http://localhost' }
					}));
					const body = Buffer.from(await response.arrayBuffer());
					const headers = new Headers(response.headers);
					// Fetch already decoded the body; Node must frame these bytes anew.
					headers.delete('content-encoding');
					headers.delete('content-length');
					headers.delete('transfer-encoding');
					res.writeHead(response.status, Object.fromEntries(headers));
					res.end(body);
				} catch {
					res.writeHead(502, { 'content-type': 'text/plain' });
					res.end('STB proxy error: Internal Server Error');
				}
			});
		}
	};
}

export default defineConfig(({ mode }) => {
	const offlinePreview = mode === 'offline-preview';
	const shellVersion = process.env.OFFLINE_SHELL_VERSION ?? String(Date.now());
	const env = loadEnv(mode, process.cwd(), 'STB_');
	const appId = env.STB_APP_ID;
	const appKey = env.STB_APP_KEY;

	if (!appId || !appKey) {
		console.warn(
			'Warning: STB_APP_ID and/or STB_APP_KEY not set. ' +
				'The dev proxy will not be able to authenticate with the STB API. ' +
				'Copy .env.example to .env and fill in the credentials.'
		);
	}

	return {
		define: { __OFFLINE_SHELL_VERSION__: JSON.stringify(offlinePreview ? shellVersion : '') },
		// Component browser fixtures are development-only; never part of the deployed routes.
		server: mode === 'test' ? { fs: { allow: ['./e2e'] } } : undefined,
		plugins: [
			{
				name: 'offline-preview-config',
				resolveId(id) { if (id === 'virtual:offline-preview-config') return '\0offline-preview-config'; },
				load(id) {
					if (id !== '\0offline-preview-config') return;
					if (!offlinePreview) return 'export default null';
					const config = JSON.parse(readFileSync('.offline-preview/config.json', 'utf8'));
					return `export default ${JSON.stringify(config)}`;
				}
			},
			stbProxy(appId, appKey),
			sveltekit(),
			SvelteKitPWA({
				registerType: offlinePreview ? 'prompt' : 'autoUpdate',
				strategies: 'injectManifest',
				srcDir: 'src',
				filename: offlinePreview ? 'service-worker-offline.ts' : 'service-worker.ts',
				injectRegister: null,
				injectManifest: { globPatterns: offlinePreview ? ['**/*.{js,mjs,css,html,svg,png,woff,woff2,json}'] : [],
					...(offlinePreview ? { maximumFileSizeToCacheInBytes: 8 * 1024 ** 2 } : {}) },
				manifest: {
					name: offlinePreview ? 'Alt InfoTB — Offline preview' : 'Alt InfoTB',
					short_name: offlinePreview ? 'InfoTB Preview' : 'AltInfoTB',
					description: 'Real-time transit arrivals for București — bus, tram, trolleybus',
					start_url: '/alt-infotb/',
					scope: '/alt-infotb/',
					display: 'standalone',
					orientation: 'portrait-primary',
					categories: ['travel', 'utilities'],
					background_color: '#1a1a2e',
					theme_color: '#1a1a2e',
					lang: 'ro',
					icons: [
						{
							src: '/alt-infotb/icons/icon-180x180.png',
							sizes: '180x180',
							type: 'image/png'
						},
						{
							src: '/alt-infotb/icons/icon-192x192.png',
							sizes: '192x192',
							type: 'image/png'
						},
						{
							src: '/alt-infotb/icons/icon-512x512.png',
							sizes: '512x512',
							type: 'image/png'
						},
						{
							src: '/alt-infotb/icons/icon-512x512.png',
							sizes: '512x512',
							type: 'image/png',
							purpose: 'maskable'
						}
					]
				}
			})
		]
	};
});
