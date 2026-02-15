<script lang="ts">
	import { onMount } from 'svelte';
	import type { Station, StationWithDistance } from '$lib/stations/types.js';
	import type { GeoPosition } from '$lib/stores/geolocation.svelte.js';

	interface Props {
		stations: StationWithDistance[];
		selectedStationId: number | null;
		userPosition: GeoPosition | null;
		theme: 'light' | 'dark';
		onStationSelect: (station: Station) => void;
	}

	let { stations, selectedStationId, userPosition, theme, onStationSelect }: Props = $props();

	let mapContainer: HTMLDivElement;
	let map: L.Map | null = null;
	let tileLayer: L.TileLayer | null = null;
	let stationMarkers: L.Marker[] = [];
	let userMarker: L.Marker | null = null;
	let accuracyCircle: L.Circle | null = null;
	let loaded = $state(false);

	// Lazy-load Leaflet modules
	let L: typeof import('leaflet') | null = null;
	let tileConfigs: typeof import('./map/tiles.js').TILE_CONFIGS | null = null;
	let stationIcons: typeof import('./map/station-icons.js') | null = null;
	let userMarkerModule: typeof import('./map/user-marker.js') | null = null;

	onMount(() => {
		loadMap();
		return () => {
			map?.remove();
			map = null;
		};
	});

	async function loadMap() {
		const [leaflet, tiles, icons, userMod] = await Promise.all([
			import('leaflet'),
			import('./map/tiles.js'),
			import('./map/station-icons.js'),
			import('./map/user-marker.js')
		]);
		// Need to import Leaflet CSS
		await import('leaflet/dist/leaflet.css');

		L = leaflet.default ?? leaflet;
		tileConfigs = tiles.TILE_CONFIGS;
		stationIcons = icons;
		userMarkerModule = userMod;

		const center: [number, number] = userPosition
			? [userPosition.lat, userPosition.lon]
			: [44.4268, 26.1025];

		map = L.map(mapContainer, {
			center,
			zoom: 15,
			zoomControl: false,
			attributionControl: false
		});

		// Add zoom control to top-right
		L.control.zoom({ position: 'topright' }).addTo(map);
		L.control.attribution({ position: 'bottomleft' }).addTo(map);

		const config = tileConfigs[theme];
		tileLayer = L.tileLayer(config.url, {
			attribution: config.attribution,
			maxZoom: config.maxZoom
		}).addTo(map);

		loaded = true;
		updateStationMarkers();
		updateUserMarker();
	}

	function updateStationMarkers() {
		if (!map || !L || !stationIcons) return;

		// Remove old markers
		for (const marker of stationMarkers) {
			marker.remove();
		}
		stationMarkers = [];

		// Add new markers
		for (const station of stations) {
			const isSelected = station.id === selectedStationId;
			const icon = isSelected
				? stationIcons.createSelectedStationIcon()
				: stationIcons.createStationIcon();

			const marker = L.marker([station.lat, station.lon], { icon })
				.addTo(map!)
				.on('click', () => onStationSelect(station));

			// Add tooltip with station name
			marker.bindTooltip(station.name, {
				direction: 'top',
				offset: [0, -10]
			});

			stationMarkers.push(marker);
		}

		fitBounds();
	}

	function updateUserMarker() {
		if (!map || !L || !userMarkerModule || !userPosition) return;

		const latLng: [number, number] = [userPosition.lat, userPosition.lon];

		if (userMarker) {
			userMarker.setLatLng(latLng);
		} else {
			userMarker = L.marker(latLng, {
				icon: userMarkerModule.createUserIcon(),
				zIndexOffset: 1000
			}).addTo(map);
		}

		if (accuracyCircle) {
			accuracyCircle.setLatLng(latLng);
			accuracyCircle.setRadius(userPosition.accuracy);
		} else {
			accuracyCircle = L.circle(latLng, {
				radius: userPosition.accuracy,
				color: '#4285f4',
				fillColor: '#4285f4',
				fillOpacity: 0.1,
				weight: 1
			}).addTo(map);
		}
	}

	function fitBounds() {
		if (!map || !L) return;

		const points: [number, number][] = stations.map((s) => [s.lat, s.lon]);
		if (userPosition) {
			points.push([userPosition.lat, userPosition.lon]);
		}

		if (points.length > 1) {
			const bounds = L.latLngBounds(points);
			map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
		}
	}

	function recenter() {
		if (!map || !L) return;
		if (userPosition) {
			map.setView([userPosition.lat, userPosition.lon], 15, { animate: true });
		}
	}

	// React to station changes
	$effect(() => {
		if (loaded) {
			stations; // track dependency
			selectedStationId; // track dependency
			updateStationMarkers();
		}
	});

	// React to user position changes
	$effect(() => {
		if (loaded && userPosition) {
			updateUserMarker();
		}
	});

	// React to theme changes
	$effect(() => {
		if (map && tileLayer && tileConfigs && L) {
			const config = tileConfigs[theme];
			tileLayer.setUrl(config.url);
		}
	});
</script>

<div class="map-wrapper">
	<div class="map-container" bind:this={mapContainer}>
		{#if !loaded}
			<div class="map-loading">
				<span class="map-loading-text">Hartă...</span>
			</div>
		{/if}
	</div>
	{#if loaded && userPosition}
		<button class="recenter-btn" onclick={recenter} aria-label="Recentrare">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="3" />
				<path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
			</svg>
		</button>
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
		bottom: 1rem;
		right: 1rem;
		z-index: 1000;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
		border: none;
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background-color 0.15s;
	}

	.recenter-btn:hover {
		background: var(--color-surface-hover);
	}

	/* Override Leaflet default styles */
	:global(.leaflet-container) {
		font-family: inherit;
	}

	:global(.station-marker),
	:global(.station-marker-selected),
	:global(.user-location-marker) {
		background: transparent !important;
		border: none !important;
	}
</style>
