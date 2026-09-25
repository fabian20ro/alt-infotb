import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
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
		// Component browser fixtures are development-only; never part of the deployed routes.
		server: mode === 'test' ? { fs: { allow: ['./e2e'] } } : undefined,
		plugins: [
			stbProxy(appId, appKey),
			sveltekit(),
			SvelteKitPWA({
				registerType: 'autoUpdate',
				manifest: {
					name: 'Alt InfoTB',
					short_name: 'AltInfoTB',
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
				},
				workbox: {
					globPatterns: [],
					runtimeCaching: [
						{
							urlPattern: /^https:\/\/info\.stb\.ro\/.*/i,
							handler: 'NetworkOnly'
						},
						{
							urlPattern: /\/stb-api\/.*/i,
							handler: 'NetworkOnly'
						},
						{
							urlPattern: /\.(?:js|css|html|svg|png|woff|woff2|json)$/i,
							handler: 'StaleWhileRevalidate',
							options: {
								cacheName: 'static-assets',
								expiration: { maxEntries: 100, maxAgeSeconds: 3 * 60 }
							}
						},
						{
							urlPattern: /^https:\/\/[a-z]\.basemaps\.cartocdn\.com\/.*/i,
							handler: 'StaleWhileRevalidate',
							options: {
								cacheName: 'map-tiles',
								expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 }
							}
						}
					]
				}
			})
		]
	};
});
