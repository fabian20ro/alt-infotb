<script lang="ts">
	import { onMount } from 'svelte';
	import type { Station } from '$lib/stations/types.js';
	import { translations } from '$lib/i18n/translations.js';
	import type { Lang } from '$lib/stores/settings.svelte.js';
	import { createMapScene, type MapSceneInput, type RouteOverviewRequest } from '$lib/map/model.js';
	import { createMapController, type LocationStatus } from '$lib/map/controller.js';
	import type { BasemapStatus, MapRenderer } from '$lib/map/renderer.js';

	interface Props extends Omit<MapSceneInput, 'locationError' | 'route'> {
		locationError?: string | null;
		lang?: Lang;
		route?: MapSceneInput['route'];
		overviewRequest?: RouteOverviewRequest | null;
		onStationSelect: (station: Station) => void;
	}

	let { allStations, selectedStationId, userPosition, locationPermission,
		locationError = null, lang = 'ro', theme, route = null,
		overviewRequest = null, onStationSelect }: Props = $props();
	let mapContainer: HTMLDivElement;
	let renderer: MapRenderer | null = null;
	let controller: ReturnType<typeof createMapController> | null = null;
	let loaded = $state(false);
	let satellite = $state(false);
	let tileStatus = $state<BasemapStatus>('loading');
	let tileRetryCoolingDown = $state(false);
	let locationStatus = $state<LocationStatus>({ pending: false, error: null });
	let pendingRecenter = $derived(locationStatus.pending);
	let recenterError = $derived(locationStatus.error);
	let strings = $derived(translations[lang]);
	let scene = $derived(createMapScene({ allStations, selectedStationId, userPosition,
		locationPermission, locationError, theme, route }));

	onMount(() => {
		let disposed = false;
		void import('$lib/map/leaflet-renderer.js').then(({ createLeafletRenderer }) => {
			// Navigation may unmount the component while the lazy chunk is loading.
			if (disposed) return;
			renderer = createLeafletRenderer(mapContainer, scene, {
				onStationSelect: (station) => onStationSelect(station),
				onBasemapStatus: (status) => { tileStatus = status; },
				onRetryCooldown: (active) => { tileRetryCoolingDown = active; },
				onCameraIdle: () => controller?.cameraIdle()
			});
			controller = createMapController(renderer, (status) => { locationStatus = status; });
			loaded = true;
		});
		return () => { disposed = true; renderer?.destroy(); renderer = null; controller = null; };
	});

	$effect(() => {
		const nextScene = scene;
		if (loaded) controller?.update(nextScene);
	});
	$effect(() => {
		const basemap = satellite ? 'satellite' : theme;
		if (loaded) renderer?.setBasemap(basemap);
	});
	$effect(() => {
		const request = overviewRequest;
		if (loaded) controller?.overview(request);
	});

	function recenter() { controller?.recenter(); }
	function retryTiles() { renderer?.retryBasemap(); }
</script>

<div class="map-wrapper" class:route-mode={!!route}>
	<div class="map-container" bind:this={mapContainer}>
		{#if !loaded}
			<div class="map-loading">
				<span class="map-loading-text">{strings.loadingMap}</span>
			</div>
		{/if}
	</div>
	{#if loaded}
		{#if tileStatus !== 'ready' || satellite}
			<div class="tile-status" data-testid="tile-status">
				{#if tileStatus === 'loading'}
					<p role="status">{strings.mapBackgroundLoading}</p>
				{:else if tileStatus === 'missing-key' || tileStatus === 'unavailable'}
					<p role="status">{tileStatus === 'missing-key' ? strings.mapNotConfigured : strings.mapUnavailable}</p>
				{/if}
				<div class="tile-actions">
					{#if satellite}
						<button onclick={() => { satellite = false; }}>{strings.mapStreet}</button>
					{:else}
						<button onclick={() => { satellite = true; }}>{strings.mapSatellite}</button>
					{/if}
					{#if tileStatus === 'unavailable'}
						<button onclick={retryTiles} disabled={tileRetryCoolingDown}>
							{tileRetryCoolingDown ? strings.mapRetryWait : strings.mapRetry}
						</button>
					{/if}
				</div>
			</div>
		{/if}
		<button 
			class="recenter-btn" 
			onclick={recenter} 
			aria-label={strings.recenter}
			title={strings.recenter}
			aria-busy={pendingRecenter && !userPosition}
			class:has-position={!!userPosition}
			class:is-denied={locationPermission === 'denied'}
		>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="3" />
				<path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
			</svg>
		</button>
		{#if (pendingRecenter && !userPosition) || recenterError}
			<div class="location-status" role="status">
				{recenterError ? strings[recenterError] : strings.locationWaiting}
			</div>
		{/if}
	{/if}
</div>

<style>
	.map-wrapper {
		position: relative;
		width: 100%;
		height: min(50dvh, 100vw);
		flex-shrink: 0;
	}

	.map-container {
		width: 100%;
		height: 100%;
	}

	.map-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		background: var(--color-surface);
	}

	.map-loading-text {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.recenter-btn {
		position: absolute;
		top: calc(10px + 64px + 12px); /* 10px (map top) + 64px (zoom controls) + 12px spacing */
		right: 10px;
		z-index: 1000;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
		border: 2px solid var(--color-surface);
		background: var(--color-accent);
		color: var(--color-bg);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: filter 0.15s, transform 0.15s, box-shadow 0.15s;
		opacity: 1;
	}

	.recenter-btn.has-position {
		box-shadow: 0 0 0 2px var(--color-surface), 0 2px 8px rgba(0, 0, 0, 0.4);
	}

	.recenter-btn.is-denied {
		border-color: var(--color-error);
		background: var(--color-error);
		color: white;
	}

	.recenter-btn:hover {
		filter: brightness(1.1);
	}

	.recenter-btn:active {
		transform: scale(0.95);
		filter: brightness(0.95);
	}

	.recenter-btn:focus-visible {
		outline: 3px solid var(--color-text);
		outline-offset: 2px;
	}

	.location-status {
		position: absolute;
		top: 10px;
		left: 10px;
		max-width: calc(100% - 80px);
		z-index: 1000;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.8rem;
		pointer-events: none;
	}

	.tile-status {
		position: absolute;
		bottom: 2rem;
		left: 10px;
		max-width: min(28rem, calc(100% - 80px));
		z-index: 1000;
		padding: 0.5rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.8rem;
	}

	.tile-status p { margin: 0 0 0.25rem; }
	.tile-actions { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; }
	.tile-actions button {
		min-height: 44px;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-accent);
		border-radius: 0.375rem;
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
		font: inherit;
	}
	.tile-actions button:disabled { opacity: 0.6; cursor: wait; }
	.tile-actions button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

</style>
