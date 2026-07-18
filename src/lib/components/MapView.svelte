<script lang="ts">
	import { onMount } from 'svelte';
	import type { ArrivalInfo, VehiclePosition } from '$lib/api/types.js';
	import type { Station } from '$lib/stations/types.js';
	import type { GeoPosition } from '$lib/stores/geolocation.svelte.js';
	import { findStationsInBounds, type LatLngBounds } from '$lib/stations/geo.js';

	const MAX_VISIBLE_MARKERS = 100;
	const DEBOUNCE_MS = 150;

	export interface MapRouteOverlay {
		key: string;
		lineName: string;
		primary: ArrivalInfo | null;
		opposite: ArrivalInfo | null;
		approachingVehicleIds: number[];
		turnaroundVehicleIds: number[];
	}

	interface Props {
		allStations: Station[];
		selectedStationId: number | null;
		userPosition: GeoPosition | null;
		locationPermission: 'granted' | 'denied' | 'prompt';
		theme: 'light' | 'dark';
		route?: MapRouteOverlay | null;
		overviewRequest?: number;
		onStationSelect: (station: Station) => void;
	}

	let {
		allStations,
		selectedStationId,
		userPosition,
		locationPermission,
		theme,
		route = null,
		overviewRequest = 0,
		onStationSelect
	}: Props = $props();

	let mapContainer: HTMLDivElement;
	let map: L.Map | null = null;
	let tileLayer: L.TileLayer | null = null;
	let markerCache = new Map<number, L.Marker>();
	let currentSelectedId: number | null = null;
	let userMarker: L.Marker | null = null;
	let accuracyCircle: L.Circle | null = null;
	let routeCasing: L.Polyline | null = null;
	let primaryRouteLine: L.Polyline | null = null;
	let oppositeRouteLine: L.Polyline | null = null;
	let primaryVehicleMarkers = new Map<number, L.Marker>();
	let oppositeVehicleMarkers = new Map<number, L.Marker>();
	let lastFittedRouteKey: string | null = null;
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
			removeRouteOverlay();
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

				const marker = L.marker([station.lat, station.lon], {
					icon,
					title: station.name,
					alt: station.name
				})
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
		
		if (locationPermission === 'denied') {
			alert('Accesul la locație este blocat. Vă rugăm să îl activați din setările browserului pentru a folosi această funcție.');
			return;
		}
		
		if (userPosition) {
			map.setView([userPosition.lat, userPosition.lon], 15, { animate: true });
			return;
		}
		
		if (userMarker) {
			map.setView(userMarker.getLatLng(), 15, { animate: true });
			return;
		}

		console.warn('[MapView] Recenter failed: no user position or marker');
	}

	function safeColor(color: string | undefined): string {
		return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#0077b6';
	}

	function escapeHtml(value: string): string {
		return value.replace(/[&<>'"]/g, (char) => ({
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			"'": '&#39;',
			'"': '&quot;'
		})[char]!);
	}

	function vehicleIcon(lineName: string, color: string, variant: 'primary' | 'opposite', emphasized: boolean) {
		if (!L) throw new Error('Leaflet is not loaded');
		const label = escapeHtml(lineName);
		return L.divIcon({
			className: 'vehicle-marker-shell',
			html: `<span class="vehicle-marker ${variant}${emphasized ? ' emphasized' : ''}" style="--vehicle-color:${safeColor(color)}">${label}</span>`,
			iconSize: [44, 44],
			iconAnchor: [22, 22]
		});
	}

	function syncVehicleMarkers(
		markers: Map<number, L.Marker>,
		vehicles: VehiclePosition[],
		arrival: ArrivalInfo,
		variant: 'primary' | 'opposite',
		emphasizedIds: Set<number>
	) {
		if (!map || !L) return;
		const currentIds = new Set(vehicles.map((vehicle) => vehicle.id));
		for (const [id, marker] of markers) {
			if (!currentIds.has(id)) {
				marker.remove();
				markers.delete(id);
			}
		}

		for (const vehicle of vehicles) {
			const latLng: [number, number] = [vehicle.lat, vehicle.lng];
			const emphasized = emphasizedIds.has(vehicle.id);
			const title = `${arrival.lineName} · ${arrival.direction || arrival.vehicleType}`;
			const existing = markers.get(vehicle.id);
			if (existing) {
				existing.setLatLng(latLng);
				existing.setIcon(vehicleIcon(arrival.lineName, arrival.color, variant, emphasized));
				continue;
			}
			const marker = L.marker(latLng, {
				icon: vehicleIcon(arrival.lineName, arrival.color, variant, emphasized),
				title,
				alt: title,
				zIndexOffset: variant === 'primary' ? 800 : 700
			}).addTo(map);
			marker.bindTooltip(title, { direction: 'top', offset: [0, -17] });
			markers.set(vehicle.id, marker);
		}
	}

	function clearVehicleMarkers(markers: Map<number, L.Marker>) {
		for (const marker of markers.values()) marker.remove();
		markers.clear();
	}

	function removeRouteOverlay() {
		routeCasing?.remove();
		primaryRouteLine?.remove();
		oppositeRouteLine?.remove();
		routeCasing = null;
		primaryRouteLine = null;
		oppositeRouteLine = null;
		clearVehicleMarkers(primaryVehicleMarkers);
		clearVehicleMarkers(oppositeVehicleMarkers);
		lastFittedRouteKey = null;
	}

	function drawRouteOverlay() {
		if (!map || !L) return;
		if (!route) {
			removeRouteOverlay();
			return;
		}

		const primary = route.primary;
		const opposite = route.opposite;
		const primaryCoordinates = primary?.path.map((point) => [point.lat, point.lng] as [number, number]) ?? [];
		const oppositeCoordinates = opposite?.path.map((point) => [point.lat, point.lng] as [number, number]) ?? [];

		if (primaryCoordinates.length >= 2) {
			if (!routeCasing) {
				routeCasing = L.polyline(primaryCoordinates, {
					className: 'selected-route-casing',
					color: theme === 'dark' ? '#10121c' : '#ffffff',
					weight: 8,
					opacity: 0.86,
					interactive: false
				}).addTo(map);
			} else {
				routeCasing.setLatLngs(primaryCoordinates);
				routeCasing.setStyle({ color: theme === 'dark' ? '#10121c' : '#ffffff' });
			}
			if (!primaryRouteLine) {
				primaryRouteLine = L.polyline(primaryCoordinates, {
					className: 'selected-route-line',
					color: safeColor(primary?.color),
					weight: 5,
					opacity: 1,
					interactive: false
				}).addTo(map);
			} else {
				primaryRouteLine.setLatLngs(primaryCoordinates);
				primaryRouteLine.setStyle({ color: safeColor(primary?.color) });
			}
		} else {
			routeCasing?.remove();
			primaryRouteLine?.remove();
			routeCasing = null;
			primaryRouteLine = null;
		}

		if (oppositeCoordinates.length >= 2) {
			if (!oppositeRouteLine) {
				oppositeRouteLine = L.polyline(oppositeCoordinates, {
					className: 'opposite-route-line',
					color: safeColor(opposite?.color),
					weight: 4,
					opacity: 0.72,
					dashArray: '8 9',
					interactive: false
				}).addTo(map);
			} else {
				oppositeRouteLine.setLatLngs(oppositeCoordinates);
				oppositeRouteLine.setStyle({ color: safeColor(opposite?.color) });
			}
		} else {
			oppositeRouteLine?.remove();
			oppositeRouteLine = null;
		}

		if (primary) {
			syncVehicleMarkers(
				primaryVehicleMarkers,
				primary.vehicles,
				primary,
				'primary',
				new Set(route.approachingVehicleIds)
			);
		} else {
			clearVehicleMarkers(primaryVehicleMarkers);
		}
		if (opposite) {
			syncVehicleMarkers(
				oppositeVehicleMarkers,
				opposite.vehicles,
				opposite,
				'opposite',
				new Set(route.turnaroundVehicleIds)
			);
		} else {
			clearVehicleMarkers(oppositeVehicleMarkers);
		}

		if (lastFittedRouteKey !== route.key && (primaryCoordinates.length >= 2 || oppositeCoordinates.length >= 2)) {
			lastFittedRouteKey = route.key;
			fitRouteOverview();
		}
	}

	function fitRouteOverview() {
		if (!map || !L || !route) return;
		const points = [
			...(route.primary?.path ?? []),
			...(route.opposite?.path ?? [])
		].map((point) => [point.lat, point.lng] as [number, number]);
		if (points.length < 2) return;
		map.fitBounds(L.latLngBounds(points), {
			paddingTopLeft: [24, 24],
			paddingBottomRight: [64, 24],
			animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches
		});
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

	// Route geometry and positions update independently from station markers.
	$effect(() => {
		if (!loaded) return;
		route;
		theme;
		drawRouteOverlay();
	});

	$effect(() => {
		if (!loaded || !route) return;
		overviewRequest;
		if (overviewRequest > 0) fitRouteOverview();
	});
</script>

<div class="map-wrapper" class:route-mode={!!route}>
	<div class="map-container" bind:this={mapContainer}>
		{#if !loaded}
			<div class="map-loading">
				<span class="map-loading-text">Hartă...</span>
			</div>
		{/if}
	</div>
	{#if loaded}
		<button 
			class="recenter-btn" 
			onclick={recenter} 
			aria-label="Recentrare" 
			class:has-position={!!userPosition}
			class:is-denied={locationPermission === 'denied'}
		>
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
		top: calc(10px + 64px + 12px); /* 10px (map top) + 64px (zoom controls) + 12px spacing */
		right: 10px;
		z-index: 1000;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
		border: none;
		background: var(--color-surface);
		color: var(--color-text-muted);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background-color 0.15s, color 0.15s;
		opacity: 0.7;
	}

	.recenter-btn.has-position {
		color: var(--color-text);
		opacity: 1;
	}

	.recenter-btn.is-denied {
		color: #ff4444;
		opacity: 1;
	}

	.recenter-btn:hover {
		background: var(--color-surface-hover);
	}

	.recenter-btn:active {
		transform: scale(0.95);
		background: var(--color-surface-active);
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

	.route-mode :global(.station-marker) {
		opacity: 0.32;
	}

	:global(.vehicle-marker-shell) {
		background: transparent !important;
		border: none !important;
	}

	:global(.vehicle-marker) {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		margin: 0.375rem;
		border: 3px solid #fff;
		border-radius: 50%;
		background: var(--vehicle-color);
		color: #fff;
		box-shadow: 0 2px 7px rgb(0 0 0 / 0.45);
		font-size: 0.65rem;
		font-weight: 800;
		line-height: 1;
	}

	:global(.vehicle-marker.opposite) {
		border-color: var(--vehicle-color);
		background: var(--color-surface);
		color: var(--color-text);
	}

	:global(.vehicle-marker.emphasized) {
		outline: 3px solid var(--color-warning);
		outline-offset: 2px;
	}
</style>
