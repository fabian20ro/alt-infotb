import * as ml from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './maplibre-renderer.css';
import type { FeatureCollection, LineString, Polygon } from 'geojson';
import { visibleStations, type Basemap, type MapDirection, type MapScene } from './model.js';
import type { MapCamera, MapRenderer, MapRendererEvents } from './renderer.js';
import type { OfflineBasemapSource } from './pmtiles-source.js';
import { getTileConfig, verifyCartoTile, centerTileUrl, TILE_RETRY_COOLDOWN_MS } from '../components/map/tiles.js';

ml.setWorkerUrl(workerUrl);
const EMPTY_STYLE = (): ml.StyleSpecification => ({ version: 8, sources: {}, layers: [] });
const ROUTES = 'transit-routes';
const ACCURACY = 'transit-accuracy';
const safeColor = (color: string | undefined) => color && /^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(color) ? color : '#0077b6';
const finitePoint = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

export interface MapLibreRendererOptions {
	offline?: OfflineBasemapSource;
	lang?: 'ro' | 'en';
}

export interface MapLibreRenderer extends MapRenderer {
	/** Read-only preview diagnostics; vendor types never enter the shared renderer contract. */
	inspect(): { camera: MapCamera; features: number; symbols: number; routeFeatures: number;
		moving: boolean; stationCount: number; vehicleCount: number; styleLoaded: boolean };
}

/** Preview-only factory. The caller decides which engine/source to use; storage stays outside. */
export function createMapLibreRenderer(container: HTMLElement, initialScene: MapScene,
	events: MapRendererEvents, options: MapLibreRendererOptions = {}): MapLibreRenderer {
	let scene = initialScene;
	let basemap: Basemap = scene.theme;
	let destroyed = false;
	let activation = 0;
	let activeStyle = 0;
	let styleFailed = false;
	let offlineActive = false;
	let confirmedActivation = 0;
	let confirmationPending = false;
	let overlaysDirty = true;
	let probe: AbortController | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let loadTimer: ReturnType<typeof setTimeout> | undefined;
	let markerTimer: ReturnType<typeof setTimeout> | undefined;
	let coolingDown = false;
	let destroyResult: Promise<void> | undefined;
	const stations = new Map<number, { marker: ml.Marker; button: HTMLButtonElement }>();
	const vehicles = new Map<string, { marker: ml.Marker; element: HTMLDivElement }>();
	let user: ml.Marker | null = null;
	const originalChildren = new Set(container.childNodes);
	const originalClasses = new Set(container.classList);
	container.classList.add('maplibre-preview-engine');
	let map: ml.Map;
	try { map = new ml.Map({ container, style: EMPTY_STYLE(),
		center: scene.userPosition ? [scene.userPosition.lon, scene.userPosition.lat] : [26.1025, 44.4268],
		// MapLibre's 512px world needs zoom-1 to match the existing 256px Leaflet contract.
		zoom: 14, minZoom: -1, maxZoom: 18, attributionControl: false, renderWorldCopies: false,
		pitchWithRotate: false, dragRotate: false, touchPitch: false, fadeDuration: 0,
		localIdeographFontFamily: 'sans-serif',
		locale: options.lang === 'ro' ? { 'NavigationControl.ZoomIn': 'Mărește', 'NavigationControl.ZoomOut': 'Micșorează',
			'AttributionControl.ToggleAttribution': 'Afișează atribuirea', 'Map.Title': 'Hartă' } : undefined
	}); } catch (error) {
		// Preserve the caller's Svelte nodes if GPU initialization fails partway through construction.
		for (const node of [...container.childNodes]) if (!originalChildren.has(node)) node.remove();
		for (const name of [...container.classList]) if (!originalClasses.has(name)) container.classList.remove(name);
		for (const name of originalClasses) container.classList.add(name);
		const offline = options.offline;
		if (offline) void (async () => {
			try { await offline.failed(error instanceof Error ? error : new Error(String(error))); }
			finally { await offline.close(); }
		})().catch(() => {});
		throw error;
	}
	map.touchZoomRotate.disableRotation();
	map.keyboard.disableRotation();
	map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
	map.addControl(new ml.AttributionControl({ compact: true }), 'bottom-left');

	function report(kind: 'context-lost' | 'basemap' | 'offline-data', error: unknown) {
		if (destroyed) return;
		styleFailed = true;
		if (loadTimer) clearTimeout(loadTimer);
		events.onBasemapStatus('unavailable');
		const message = error instanceof Error ? error.message : String(error);
		events.onError?.({ kind, message });
		if (offlineActive) void options.offline?.failed(error instanceof Error ? error : new Error(message)).catch(() => {});
	}
	map.on('error', event => { if (activeStyle === activation) report(offlineActive ? 'offline-data' : 'basemap', event.error); });
	map.on('styleimagemissing', event => { if (activeStyle === activation) report('offline-data', new Error(`Missing sprite: ${event.id}`)); });
	map.on('webglcontextlost', () => report('context-lost', new Error('WebGL context lost')));
	// Restoration needs an explicit retry and fresh successful render; never silently claim readiness.
	map.on('webglcontextrestored', () => { if (!destroyed) events.onBasemapStatus('unavailable'); });
	map.on('moveend', () => {
		if (markerTimer) clearTimeout(markerTimer);
		markerTimer = setTimeout(updateMarkers, 150);
		events.onCameraIdle();
	});
	map.on('style.load', () => { overlaysDirty = true; updateOverlays(); });
	map.on('idle', () => {
		// Worker/source updates can make isStyleLoaded false; retain the latest scene until they settle.
		if (overlaysDirty && updateOverlays()) return;
		if (destroyed || !activeStyle || activeStyle !== activation || styleFailed || !map.isStyleLoaded()) return;
		if (loadTimer) clearTimeout(loadTimer);
		if (offlineActive && confirmedActivation !== activation) {
			if (confirmationPending) return;
			confirmationPending = true;
			const token = activation;
			void options.offline!.rendered().then(() => {
				if (!destroyed && activation === token && !styleFailed) { confirmedActivation = token; events.onBasemapStatus('ready'); }
			}).catch(error => { if (activation === token) report('offline-data', error); })
				.finally(() => { if (activation === token) confirmationPending = false; });
		} else events.onBasemapStatus('ready');
	});

	function updateMarkers() {
		if (destroyed) return;
		const bounds = map.getBounds();
		const visible = visibleStations(scene, { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() });
		const ids = new Set(visible.map(s => s.id));
		for (const [id, record] of stations) if (!ids.has(id)) { record.marker.remove(); stations.delete(id); }
		for (const station of visible) {
			let record = stations.get(station.id);
			if (!record) {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'maplibre-station';
				button.dataset.stationId = String(station.id);
				const dot = document.createElement('span'); dot.className = 'maplibre-station-dot'; dot.setAttribute('aria-hidden', 'true');
				const label = document.createElement('span'); label.className = 'maplibre-station-label'; label.setAttribute('aria-hidden', 'true');
				button.append(dot, label);
				button.addEventListener('click', event => { event.stopPropagation(); const latest = scene.allStations.find(s => s.id === station.id); if (latest) events.onStationSelect(latest); });
				record = { button, marker: new ml.Marker({ element: button, anchor: 'center' }).setLngLat([station.lon, station.lat]).addTo(map) };
				stations.set(station.id, record);
			}
			record.marker.setLngLat([station.lon, station.lat]);
			const selected = scene.selectedStationId === station.id;
			record.button.setAttribute('aria-label', station.name);
			record.button.setAttribute('aria-pressed', String(selected));
			record.button.querySelector('.maplibre-station-label')!.textContent = station.name;
			record.button.classList.toggle('station-marker-selected', selected);
			record.button.classList.toggle('station-marker', !selected);
			record.button.classList.toggle('station-marker-on-route', scene.routeStationIds.has(station.id));
			record.button.classList.toggle('maplibre-route-mode', !!scene.route);
			// MapLibre owns inline opacity for marker visibility; CSS cannot override that state.
			record.marker.setOpacity(selected || !scene.route ? 1 : scene.routeStationIds.has(station.id) ? 0.72 : 0.32);
		}
		const position = scene.userPosition;
		if (position && finitePoint(position.lat, position.lon)) {
			if (!user) {
				const element = document.createElement('div'); element.className = 'maplibre-user user-location-marker'; element.setAttribute('aria-hidden', 'true');
				user = new ml.Marker({ element }).setLngLat([position.lon, position.lat]).addTo(map);
			} else user.setLngLat([position.lon, position.lat]);
		} else { user?.remove(); user = null; }
		updateVehicles();
	}
	function updateVehicles() {
		const desired = new Set<string>();
		for (const variant of ['primary', 'opposite'] as const) {
			const direction: MapDirection | null | undefined = scene.route?.[variant];
			for (const vehicle of direction?.vehicles ?? []) {
				if (!finitePoint(vehicle.lat, vehicle.lng)) continue;
				const key = `${variant}:${vehicle.id}`; desired.add(key);
				let record = vehicles.get(key);
				if (!record) {
					const element = document.createElement('div'); element.className = `maplibre-vehicle vehicle-marker ${variant}`;
					element.setAttribute('role', 'img'); element.dataset.vehicleId = String(vehicle.id);
					record = { element, marker: new ml.Marker({ element }).setLngLat([vehicle.lng, vehicle.lat]).addTo(map) }; vehicles.set(key, record);
				}
				record.marker.setLngLat([vehicle.lng, vehicle.lat]);
				record.element.textContent = direction!.lineName;
				const title = `${direction!.lineName} · ${direction!.direction || direction!.vehicleType}`;
				record.element.setAttribute('aria-label', title); record.element.title = title;
				record.element.style.setProperty('--vehicle-color', safeColor(direction!.color));
			}
		}
		for (const [key, record] of vehicles) if (!desired.has(key)) { record.marker.remove(); vehicles.delete(key); }
	}
	function routeData(): FeatureCollection<LineString> {
		return { type: 'FeatureCollection', features: (['primary', 'opposite'] as const).flatMap(variant => {
			const direction = scene.route?.[variant];
			const coordinates = direction?.path.filter(p => finitePoint(p.lat, p.lng)).map(p => [p.lng, p.lat]) ?? [];
			return coordinates.length < 2 ? [] : [{ type: 'Feature' as const, properties: { variant, color: safeColor(direction?.color) }, geometry: { type: 'LineString' as const, coordinates } }];
		}) };
	}
	function accuracyData(): FeatureCollection<Polygon> {
		const p = scene.userPosition;
		if (!p || !finitePoint(p.lat, p.lon) || !Number.isFinite(p.accuracy) || p.accuracy <= 0) return { type: 'FeatureCollection', features: [] };
		const radius = Math.min(p.accuracy, 1_000_000) / 6_371_000, lat = p.lat * Math.PI / 180, lon = p.lon * Math.PI / 180;
		const coordinates: number[][] = [];
		for (let i = 0; i <= 64; i++) {
			const angle = 2 * Math.PI * i / 64;
			const nextLat = Math.asin(Math.sin(lat) * Math.cos(radius) + Math.cos(lat) * Math.sin(radius) * Math.cos(angle));
			const nextLon = lon + Math.atan2(Math.sin(angle) * Math.sin(radius) * Math.cos(lat), Math.cos(radius) - Math.sin(lat) * Math.sin(nextLat));
			coordinates.push([nextLon * 180 / Math.PI, nextLat * 180 / Math.PI]);
		}
		return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } }] };
	}
	function updateOverlays(): boolean {
		if (destroyed || !map.isStyleLoaded()) return false;
		overlaysDirty = false;
		const data = routeData(), accuracy = accuracyData();
		const source = map.getSource(ROUTES) as ml.GeoJSONSource | undefined;
		if (source) void source.setData(data);
		else {
			map.addSource(ROUTES, { type: 'geojson', data });
			map.addLayer({ id: 'selected-route-casing', type: 'line', source: ROUTES, filter: ['==', ['get', 'variant'], 'primary'],
				paint: { 'line-color': scene.theme === 'dark' ? '#10121c' : '#ffffff', 'line-width': 8, 'line-opacity': 0.86 } });
			map.addLayer({ id: 'selected-route-line', type: 'line', source: ROUTES, filter: ['==', ['get', 'variant'], 'primary'],
				paint: { 'line-color': ['get', 'color'], 'line-width': 5 } });
			map.addLayer({ id: 'opposite-route-line', type: 'line', source: ROUTES, filter: ['==', ['get', 'variant'], 'opposite'],
				paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.72, 'line-dasharray': [2, 2.25] } });
		}
		map.setPaintProperty('selected-route-casing', 'line-color', scene.theme === 'dark' ? '#10121c' : '#ffffff');
		const accuracySource = map.getSource(ACCURACY) as ml.GeoJSONSource | undefined;
		if (accuracySource) void accuracySource.setData(accuracy);
		else {
			map.addSource(ACCURACY, { type: 'geojson', data: accuracy });
			map.addLayer({ id: 'user-accuracy-fill', type: 'fill', source: ACCURACY, paint: { 'fill-color': '#4285f4', 'fill-opacity': 0.1 } }, 'selected-route-casing');
			map.addLayer({ id: 'user-accuracy-outline', type: 'line', source: ACCURACY, paint: { 'line-color': '#4285f4', 'line-width': 1 } }, 'selected-route-casing');
		}
		return true;
	}
	async function setStyle(next: Basemap) {
		if (destroyed) return;
		const token = ++activation;
		probe?.abort(); probe = null;
		styleFailed = false; confirmationPending = false;
		if (loadTimer) clearTimeout(loadTimer);
		loadTimer = setTimeout(() => { if (activation === token) report(offlineActive ? 'offline-data' : 'basemap', new Error('Map rendering timed out')); }, 30_000);
		offlineActive = next !== 'satellite' && !!options.offline;
		events.onBasemapStatus('loading');
		try {
			let style: ml.StyleSpecification;
			if (offlineActive) style = await options.offline!.style(next as 'light' | 'dark');
			else {
				const config = getTileConfig(next);
				if (!config.url) {
					if (activation === token) { activeStyle = 0; if (loadTimer) clearTimeout(loadTimer); map.setStyle(EMPTY_STYLE(), { diff: false }); events.onBasemapStatus('missing-key'); }
					return;
				}
				const template = config.url.replace('{r}', window.devicePixelRatio > 1 ? '@2x' : '');
				if (next !== 'satellite' && navigator.onLine && !navigator.serviceWorker?.controller) {
					const controller = new AbortController(); probe = controller;
					const timeout = setTimeout(() => controller.abort(), 10_000);
					let valid: boolean;
					try { const center = map.getCenter(); valid = await verifyCartoTile(centerTileUrl(template, center.lat, center.lng, map.getZoom() + 1), controller.signal); }
					finally { clearTimeout(timeout); }
					if (destroyed || activation !== token) return;
					if (!valid) throw new Error('Raster tile verification failed');
				}
				style = { version: 8, sources: { basemap: { type: 'raster', tiles: [template], tileSize: 256, maxzoom: config.maxZoom, attribution: config.attribution } },
					layers: [{ id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-fade-duration': 0 } }] };
			}
			if (destroyed || activation !== token) return;
			activeStyle = token;
			map.setStyle(style, { diff: false });
			updateMarkers();
		} catch (error) { if (!destroyed && activation === token) { activeStyle = token; report(offlineActive ? 'offline-data' : 'basemap', error); } }
	}

	// MapLibre 6 already observes container dimensions through its own ResizeObserver.
	return {
		render(nextScene) { if (destroyed) return; scene = nextScene; overlaysDirty = true; updateMarkers(); updateOverlays(); },
		setBasemap(next) { basemap = next; void setStyle(next); },
		retryBasemap() {
			if (destroyed || coolingDown) return;
			coolingDown = true; events.onRetryCooldown(true);
			retryTimer = setTimeout(() => { coolingDown = false; if (!destroyed) events.onRetryCooldown(false); }, TILE_RETRY_COOLDOWN_MS);
			void setStyle(basemap);
		},
		setCamera({ lat, lon, zoom }, immediate) {
			if (destroyed || !finitePoint(lat, lon) || !Number.isFinite(zoom)) return false;
			map.stop();
			if (immediate) map.jumpTo({ center: [lon, lat], zoom: zoom - 1 });
			else map.easeTo({ center: [lon, lat], zoom: zoom - 1, duration: 300 });
			updateMarkers(); return true;
		},
		fitPoints(points, purpose) {
			if (destroyed || points.length < 2 || !points.every(p => finitePoint(p.lat, p.lon))) return false;
			map.stop();
			const bounds = new ml.LngLatBounds(); for (const p of points) bounds.extend([p.lon, p.lat]);
			map.fitBounds(bounds, { padding: purpose === 'initial' ? 30 : { top: 24, bottom: 24, left: 24, right: 64 },
				maxZoom: purpose === 'initial' ? 15 : 18, duration: purpose === 'initial' ? 0 : 300 });
			updateMarkers(); return true;
		},
		inspect() {
			const center = map.getCenter();
			const features = map.isStyleLoaded() ? map.queryRenderedFeatures() : [];
			return { camera: { lat: center.lat, lon: center.lng, zoom: map.getZoom() + 1 },
				features: features.length, symbols: features.filter(f => f.layer.type === 'symbol').length,
				routeFeatures: features.filter(f => f.source === ROUTES).length, moving: map.isMoving(),
				stationCount: stations.size, vehicleCount: vehicles.size, styleLoaded: !!map.isStyleLoaded() };
		},
		destroy() {
			if (destroyResult) return destroyResult;
			destroyed = true; activation++; probe?.abort();
			if (retryTimer) clearTimeout(retryTimer); if (markerTimer) clearTimeout(markerTimer); if (loadTimer) clearTimeout(loadTimer);
			for (const { marker } of stations.values()) marker.remove(); stations.clear();
			for (const { marker } of vehicles.values()) marker.remove(); vehicles.clear(); user?.remove(); user = null;
			destroyResult = (async () => {
				try { map.remove(); } finally { container.classList.remove('maplibre-preview-engine'); await options.offline?.close(); }
			})();
			return destroyResult;
		}
	};
}
