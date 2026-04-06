<script lang="ts">
	import { onMount } from 'svelte';
	import type { Station } from '$lib/stations/types.js';
	import type { GeoPosition } from '$lib/stores/geolocation.svelte.js';
	import { findStationsInBounds, type LatLngBounds } from '$lib/stations/geo.js';

	const MAX_VISIBLE_MARKERS = 100;
	const DEBOUNCE_MS = 150;

	interface Props {
		allStations: Station[];
		selectedStationId: number | null;
		userPosition: GeoPosition | null;
		theme: 'light' | 'dark';
		onStationSelect: (station: Station) => void;
	}

	let { allStations, selectedStationId, userPosition, theme, onStationSelect }: Props = $props();

	let mapContainer: HTMLDivElement;
	let map: L.Map | null = null;
	let tileLayer: L.TileLayer | null = null;
	let markerCache = new Map<number, L.Marker>();
	let currentSelectedId: number | null = null;
	let userMarker: L.Marker | null = null;
	let accuracyCircle: L.Circle | null = null;
	let loaded = $state(false);
	let initialViewSet = false;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Lazy-load Leaflet modules
	let L: typeof import('leaflet') | null = null;
	let tileConfigs: typeof import('./map/tiles.js').TILE_CONFIGS | null = null;
	let stationIcons: typeof import('./map/station-icons.js') | null = null;
	let userMarkerModule: typeof import('./map/user-marker.js') | null = null;

	onMount(() => {
		loadMap();
		return () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			markerCache.clear();
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

		L.control.zoom({ position: 'topright' }).addTo(map);
		L.control.attribution({ position: 'bottomleft' }).addTo(map);

		const config = tileConfigs[theme];
		tileLayer = L.tileLayer(config.url, {
			attribution: config.attribution,
			maxZoom: config.maxZoom
		}).addTo(map);

		// Debounced handler for pan/zoom
		map.on('moveend', () => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(updateVisibleStations, DEBOUNCE_MS);
		});

		loaded = true;
		updateVisibleStations();
		updateUserMarker();
	}

	function updateVisibleStations() {
		if (!map || !L || !stationIcons || allStations.length === 0) return;

		const leafletBounds = map.getBounds();
		const bounds: LatLngBounds = {
			south: leafletBounds.getSouth(),
			north: leafletBounds.getNorth(),
			west: leafletBounds.getWest(),
			east: leafletBounds.getEast()
		};

		const visible = findStationsInBounds(bounds, allStations, MAX_VISIBLE_MARKERS, selectedStationId);
		const visibleIds = new Set(visible.map((s) => s.id));

		// Remove markers no longer visible
		for (const [id, marker] of markerCache) {
			if (!visibleIds.has(id)) {
				marker.remove();
				markerCache.delete(id);
			}
		}

		// Add new markers and update selection state
		for (const station of visible) {
			const isSelected = station.id === selectedStationId;
			const existing = markerCache.get(station.id);

			if (existing) {
				// Update icon if selection state changed
				const wasSelected = station.id === currentSelectedId;
				if (isSelected !== wasSelected) {
					const icon = isSelected
						? stationIcons.createSelectedStationIcon()
						: stationIcons.createStationIcon();
					existing.setIcon(icon);
				}
			} else {
				// Create new marker
				const icon = isSelected
					? stationIcons.createSelectedStationIcon()
					: stationIcons.createStationIcon();

				const marker = L.marker([station.lat, station.lon], { icon })
					.addTo(map!)
					.on('click', () => onStationSelect(station));

				marker.bindTooltip(station.name, {
					direction: 'top',
					offset: [0, -16]
				});

				markerCache.set(station.id, marker);
			}
		}

		currentSelectedId = selectedStationId;
	}

	function setInitialView() {
		if (!map || !L || initialViewSet) return;
		initialViewSet = true;

		const points: [number, number][] = [];
		if (userPosition) points.push([userPosition.lat, userPosition.lon]);

		// Include selected station if known
		if (selectedStationId) {
			const sel = allStations.find((s) => s.id === selectedStationId);
			if (sel) points.push([sel.lat, sel.lon]);
		}

		if (points.length > 1) {
			const bounds = L.latLngBounds(points);
			map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
		} else if (points.length === 1) {
			map.setView(points[0], 15);
		}
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

	function recenter() {
		if (!map || !L) return;
		if (userPosition) {
			map.setView([userPosition.lat, userPosition.lon], 15, { animate: true });
		}
	}

	// Set initial view once allStations first populates
	$effect(() => {
		if (loaded && allStations.length > 0) {
			setInitialView();
			updateVisibleStations();
		}
	});

	// React to selection changes — update marker icons
	$effect(() => {
		if (loaded) {
			selectedStationId; // track
			updateVisibleStations();
		}
	});

	// React to user position changes
	$effect(() => {
		if (loaded && userPosition) {
			updateUserMarker();
		}
	});

	// React to theme changes — read theme BEFORE guard to ensure tracking
	$effect(() => {
		const t = theme;
		if (!map || !tileLayer || !tileConfigs) return;
		const config = tileConfigs[t];
		tileLayer.setUrl(config.url);
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
		top: 5.5rem;
		right: 10px;
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
