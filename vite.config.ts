import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { STB_SERVER_HEADERS, STB_AUTH } from './src/lib/api/constants.js';

const STB_API_BASE = 'https://info.stb.ro/api/web/v2-6';

/**
 * Vite plugin that proxies /stb-api/* requests to the real STB API,
 * injecting required headers and managing the User-Info auth token.
 */
function stbProxy(): Plugin {
	let userInfoToken: string | null = null;

	async function fetchAuthToken(): Promise<string> {
		const url = `${STB_API_BASE}${STB_AUTH.AUTH_PATH}`;
		const res = await fetch(url, {
			headers: { 'App-key': STB_AUTH.APP_KEY, 'App-Id': STB_AUTH.APP_ID }
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
			headers: { ...STB_SERVER_HEADERS, 'User-Info': token }
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

export default defineConfig({
	plugins: [
		stbProxy(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Better STB',
				short_name: 'BetterSTB',
				description: 'Arrival times for STB trams in București',
				start_url: '/better-stb/',
				display: 'standalone',
				background_color: '#1a1a2e',
				theme_color: '#1a1a2e',
				lang: 'ro',
				icons: [
					{
						src: '/better-stb/icons/icon-192x192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: '/better-stb/icons/icon-512x512.png',
						sizes: '512x512',
						type: 'image/png'
					},
					{
						src: '/better-stb/icons/icon-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/info\.stb\.ro\/.*/i,
						handler: 'NetworkOnly'
					},
					{
						urlPattern: /\/stb-api\/.*/i,
						handler: 'NetworkOnly'
					}
				]
			}
		})
	]
});
