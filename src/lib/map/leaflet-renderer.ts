import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './leaflet-renderer.css';
import type { VehiclePosition } from '../api/types.js';
import type { LatLngBounds } from '../stations/geo.js';
import { visibleStations, type Basemap, type MapDirection, type MapScene } from './model.js';
import type { MapRenderer, MapRendererEvents } from './renderer.js';
import * as tilesModule from '../components/map/tiles.js';
import * as stationIcons from '../components/map/station-icons.js';
import * as userMarkerModule from '../components/map/user-marker.js';

const DEBOUNCE_MS = 150;

/** The only rendering engine in this step; loaded dynamically by MapView. */
export function createLeafletRenderer(
	container: HTMLElement,
	initialScene: MapScene,
	events: MapRendererEvents
): MapRenderer {
	let scene = initialScene;
	let { selectedStationId, userPosition, theme, route, routeStationIds } = scene;
	let basemap: Basemap = theme;
	let map: L.Map | null = L.map(container, {
		center: userPosition ? [userPosition.lat, userPosition.lon] : [44.4268, 26.1025],
		zoom: 15, zoomControl: false, attributionControl: false
	});
	let tileLayer: L.TileLayer | null = null;
	const markerCache = new Map<number, L.Marker>();
	let currentSelectedId: number | null = null;
	let userMarker: L.Marker | null = null;
	let accuracyCircle: L.Circle | null = null;
	let routeCasing: L.Polyline | null = null;
	let primaryRouteLine: L.Polyline | null = null;
	let oppositeRouteLine: L.Polyline | null = null;
	const primaryVehicleMarkers = new Map<number, L.Marker>();
	const oppositeVehicleMarkers = new Map<number, L.Marker>();
	let tileRetryCoolingDown = false;
	let tileActivation = 0;
	let tileProbe: AbortController | null = null;
	let tileRetryTimer: ReturnType<typeof setTimeout> | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let zooming = false;

	L.control.zoom({ position: 'topright' }).addTo(map);
	L.control.attribution({ position: 'bottomleft' }).addTo(map);
	map.on('zoomstart', () => { zooming = true; });
	map.on('zoomend', () => { zooming = false; events.onCameraIdle(); });
	map.on('moveend', () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(updateVisibleStations, DEBOUNCE_MS);
	});

	function updateVisibleStations() {
		if (!map) return;

		const leafletBounds = map.getBounds();
		const bounds: LatLngBounds = {
			south: leafletBounds.getSouth(),
			north: leafletBounds.getNorth(),
			west: leafletBounds.getWest(),
			east: leafletBounds.getEast()
		};

		const visible = visibleStations(scene, bounds);
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
					alt: station.name
				})
					.addTo(map!)
					.on('click', () => events.onStationSelect(station))
					.on('keydown', (event: L.LeafletKeyboardEvent) => {
						// Leaflet DivIcons are focusable role=button elements, not native buttons.
						const key = event.originalEvent.key;
						if (key === 'Enter' || key === ' ') {
							event.originalEvent.preventDefault();
							events.onStationSelect(station);
						}
					});

				marker.bindTooltip(station.name, {
					className: 'station-name-tooltip',
					interactive: false,
					direction: 'top',
					offset: [0, -16]
				});

				markerCache.set(station.id, marker);
			}
			// setIcon may replace the DivIcon DOM node. Its name must survive selection changes.
			const element = markerCache.get(station.id)?.getElement();
			element?.setAttribute('aria-label', station.name);
			element?.classList.toggle('station-marker-on-route', routeStationIds.has(station.id));
		}

		currentSelectedId = selectedStationId;
	}

	function updateUserMarker() {
		if (!map || !userPosition) return;

		const latLng: [number, number] = [userPosition.lat, userPosition.lon];

		if (userMarker) {
			userMarker.setLatLng(latLng);
		} else {
			userMarker = L.marker(latLng, {
				icon: userMarkerModule.createUserIcon(),
				interactive: false,
				keyboard: false,
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
				weight: 1,
				interactive: false
			}).addTo(map);
		}
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

	function vehicleIcon(lineName: string, color: string, variant: 'primary' | 'opposite') {
		const label = escapeHtml(lineName);
		return L.divIcon({
			className: 'vehicle-marker-shell',
			html: `<span class="vehicle-marker ${variant}" style="--vehicle-color:${safeColor(color)}">${label}</span>`,
			iconSize: [44, 44],
			iconAnchor: [22, 22]
		});
	}

	function syncVehicleMarkers(
		markers: Map<number, L.Marker>,
		vehicles: VehiclePosition[],
		arrival: MapDirection,
		variant: 'primary' | 'opposite'
	) {
		if (!map) return;
		const currentIds = new Set(vehicles.map((vehicle) => vehicle.id));
		for (const [id, marker] of markers) {
			if (!currentIds.has(id)) {
				marker.remove();
				markers.delete(id);
			}
		}

		for (const vehicle of vehicles) {
			const latLng: [number, number] = [vehicle.lat, vehicle.lng];
			const title = `${arrival.lineName} · ${arrival.direction || arrival.vehicleType}`;
			const existing = markers.get(vehicle.id);
			if (existing) {
				existing.setLatLng(latLng);
				existing.setIcon(vehicleIcon(arrival.lineName, arrival.color, variant));
				continue;
			}
			const marker = L.marker(latLng, {
				icon: vehicleIcon(arrival.lineName, arrival.color, variant),
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

	function syncDirectionVehicles(
		markers: Map<number, L.Marker>,
		arrival: MapDirection | null,
		variant: 'primary' | 'opposite'
	) {
		if (arrival) {
			syncVehicleMarkers(markers, arrival.vehicles, arrival, variant);
		} else {
			clearVehicleMarkers(markers);
		}
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
	}

	function drawRouteOverlay() {
		if (!map) return;
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

		syncDirectionVehicles(primaryVehicleMarkers, primary, 'primary');
		syncDirectionVehicles(oppositeVehicleMarkers, opposite, 'opposite');
	}

	async function setTileLayer(tileTheme: 'light' | 'dark' | 'satellite') {
		if (!map) return;
		const activation = ++tileActivation;
		tileProbe?.abort();
		tileProbe = null;
		// Leaflet removes attribution via its own remove listener; retain it until removal.
		tileLayer?.remove();
		tileLayer?.off();
		tileLayer = null;
		const config = tilesModule.getTileConfig(tileTheme);
		if (!config.url) {
			events.onBasemapStatus('missing-key');
			return;
		}
		events.onBasemapStatus('loading');
		// The SW validates every controlled CARTO response. On a fresh visit, verify
		// one visible tile first so an invalid key cannot fill the map with placeholders.
		// Offline, let individual cached tiles load even if the center tile is absent.
		if (tileTheme !== 'satellite' && navigator.onLine && !navigator.serviceWorker?.controller) {
			const controller = new AbortController();
			tileProbe = controller;
			const timeout = setTimeout(() => controller.abort(), 10_000);
			const center = map.getCenter();
			let valid = false;
			try {
				valid = await tilesModule.verifyCartoTile(
					tilesModule.centerTileUrl(config.url, center.lat, center.lng, map.getZoom()), controller.signal
				);
			} catch {
				// A failed canary needs explicit user retry; never start a request loop.
			} finally {
				clearTimeout(timeout);
			}
			if (activation !== tileActivation || !map) return;
			tileProbe = null;
			if (!valid) {
				events.onBasemapStatus('unavailable');
				return;
			}
		}
		const health = tilesModule.createTileHealthTracker();
		const layer = L.tileLayer(config.url, {
			attribution: config.attribution,
			maxZoom: config.maxZoom,
			crossOrigin: config.crossOrigin
		});
		tileLayer = layer;
		layer.on('tileerror', (event: L.TileErrorEvent) => {
			health.failed(event.tile);
			events.onBasemapStatus('unavailable');
		});
		layer.on('tileload', (event: L.TileEvent) => health.loaded(event.tile));
		layer.on('tileunload', (event: L.TileEvent) => health.unloaded(event.tile));
		layer.on('load', () => {
			events.onBasemapStatus(health.isHealthy() ? 'ready' : 'unavailable');
		});
		layer.addTo(map);
	}

	function retryTiles() {
		if (!map || tileRetryCoolingDown) return;
		tileRetryCoolingDown = true;
		events.onRetryCooldown(true);
		tileRetryTimer = setTimeout(() => {
			tileRetryCoolingDown = false;
			events.onRetryCooldown(false);
			tileRetryTimer = null;
		}, tilesModule.TILE_RETRY_COOLDOWN_MS);
		void setTileLayer(basemap);
	}


	return {
		render(nextScene) {
			scene = nextScene;
			({ selectedStationId, userPosition, theme, route, routeStationIds } = scene);
			updateVisibleStations();
			updateUserMarker();
			drawRouteOverlay();
		},
		setBasemap(nextBasemap) { basemap = nextBasemap; void setTileLayer(basemap); },
		retryBasemap: retryTiles,
		setCamera({ lat, lon, zoom }, immediate) {
			// Leaflet ignores setView during CSS zoom, even with animate:false.
			if (!map || zooming) return false;
			if (immediate) map.stop();
			map.setView([lat, lon], zoom, immediate ? { animate: false } : undefined);
			return true;
		},
		fitPoints(points, purpose) {
			if (!map || zooming || points.length < 2) return false;
			const bounds = L.latLngBounds(points.map(({ lat, lon }) => [lat, lon]));
			map.fitBounds(bounds, purpose === 'initial' ? { padding: [30, 30], maxZoom: 16 } : {
				paddingTopLeft: [24, 24], paddingBottomRight: [64, 24],
				animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches
			});
			return true;
		},
		destroy() {
			if (debounceTimer) clearTimeout(debounceTimer);
			if (tileRetryTimer) clearTimeout(tileRetryTimer);
			tileActivation++;
			tileProbe?.abort();
			removeRouteOverlay();
			markerCache.clear();
			map?.remove();
			map = null;
		}
	};
}
