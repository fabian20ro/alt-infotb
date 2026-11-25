<script lang="ts">
	import '../app.css';
	import { onMount, type Snippet } from 'svelte';
	import { base } from '$app/paths';
	import { dev } from '$app/environment';

	onMount(() => {
		if (!dev && import.meta.env.MODE === 'offline-preview') {
			void import('$lib/offline-maps/shell.js').then(({ offlineShell }) => offlineShell.start())
				.catch((error) => console.warn('Offline preview unavailable', error));
		} else if (!dev && 'serviceWorker' in navigator) {
			void import('virtual:pwa-register').then(({ registerSW }) => {
				registerSW({ immediate: true, onRegisterError: (error) => console.warn('Offline support unavailable', error) });
			}).catch((error) => console.warn('Offline support unavailable', error));
		}
	});

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<link rel="manifest" href={`${base}/manifest.webmanifest`} />
</svelte:head>

{@render children()}
