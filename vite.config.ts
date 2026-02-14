import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
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
					}
				]
			}
		})
	]
});
