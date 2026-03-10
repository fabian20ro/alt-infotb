import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { createStbServerHeaders, STB_AUTH_PATH } from './src/lib/api/constants.js';

const STB_API_BASE = 'https://info.stb.ro/api/web/v2-6';

/**
 * Vite plugin that proxies /stb-api/* requests to the real STB API,
 * injecting required headers and managing the User-Info auth token.
 */
function stbProxy(appId: string, appKey: string): Plugin {
	let userInfoToken: string | null = null;
	const serverHeaders = createStbServerHeaders(appId);

	async function fetchAuthToken(): Promise<string> {
		const url = `${STB_API_BASE}${STB_AUTH_PATH}`;
		const res = await fetch(url, {
			headers: { 'App-key': appKey, 'App-Id': appId }
		});
		const json = (await res.json()) as { data: { userInfo: string } };
		return json.data.userInfo;
	}

	async function proxyRequest(
		targetPath: string,
		token: string
	): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
		const url = `${STB_API_BASE}${targetPath}`;
		const res = await fetch(url, {
			headers: { ...serverHeaders, 'User-Info': token }
		});
		const body = Buffer.from(await res.arrayBuffer());
		const headers: Record<string, string> = {};
		res.headers.forEach((v, k) => {
			headers[k] = v;
		});
		return { status: res.status, headers, body };
	}

	return {
		name: 'stb-proxy',
		configureServer(server) {
			server.middlewares.use('/stb-api', async (req, res) => {
				try {
					if (!userInfoToken) {
						userInfoToken = await fetchAuthToken();
					}

					const targetPath = req.url ?? '/';
					let result = await proxyRequest(targetPath, userInfoToken);

					// Token expired — re-auth and retry once
					if (result.status === 412) {
						userInfoToken = await fetchAuthToken();
						result = await proxyRequest(targetPath, userInfoToken);
					}

					res.writeHead(result.status, {
						'content-type': result.headers['content-type'] ?? 'application/octet-stream',
						'access-control-allow-origin': '*'
					});
					res.end(result.body);
				} catch (err) {
					res.writeHead(502, { 'content-type': 'text/plain' });
					res.end(`STB proxy error: ${err instanceof Error ? err.message : String(err)}`);
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
		plugins: [
			stbProxy(appId, appKey),
			sveltekit(),
			SvelteKitPWA({
				registerType: 'autoUpdate',
				manifest: {
					name: 'Alt STB',
					short_name: 'AltSTB',
					description: 'Real-time transit arrivals for București — bus, tram, trolleybus',
					start_url: '/alt-stb/',
					scope: '/alt-stb/',
					display: 'standalone',
					orientation: 'portrait-primary',
					categories: ['travel', 'utilities'],
					background_color: '#1a1a2e',
					theme_color: '#1a1a2e',
					lang: 'ro',
					icons: [
						{
							src: '/alt-stb/icons/icon-180x180.png',
							sizes: '180x180',
							type: 'image/png'
						},
						{
							src: '/alt-stb/icons/icon-192x192.png',
							sizes: '192x192',
							type: 'image/png'
						},
						{
							src: '/alt-stb/icons/icon-512x512.png',
							sizes: '512x512',
							type: 'image/png'
						},
						{
							src: '/alt-stb/icons/icon-512x512.png',
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
