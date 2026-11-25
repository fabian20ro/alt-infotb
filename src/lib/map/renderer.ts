import type { Station } from '../stations/types.js';
import type { Basemap, MapScene } from './model.js';

export interface MapPoint { lat: number; lon: number }
export interface MapCamera extends MapPoint { zoom: number }
export type BasemapStatus = 'loading' | 'ready' | 'missing-key' | 'unavailable';
export interface MapRendererError {
	kind: 'context-lost' | 'basemap' | 'offline-data';
	message: string;
}

export interface MapRendererEvents {
	onStationSelect(station: Station): void;
	onBasemapStatus(status: BasemapStatus): void;
	onRetryCooldown(active: boolean): void;
	/** A blocked camera intent may be retried after an engine animation ends. */
	onCameraIdle(): void;
	onError?(error: MapRendererError): void;
}

/** Only operations the current map needs. No vendor, storage or STB transport types. */
export interface MapRenderer {
	/** Updating a scene must not change the camera. */
	render(scene: MapScene): void;
	setBasemap(basemap: Basemap): void;
	retryBasemap(): void;
	/** false means temporarily blocked; the caller retains the intent. */
	setCamera(camera: MapCamera, immediate: boolean): boolean;
	fitPoints(points: readonly MapPoint[], purpose: 'initial' | 'overview'): boolean;
	/** Optional view snapshot supports source changes without resetting camera policy. */
	getCamera?(): MapCamera;
	getBounds?(): { south: number; north: number; west: number; east: number };
	setLanguage?(lang: 'ro' | 'en'): void;
	/** Removes rendering resources before releasing any asynchronous package reader. */
	destroy(): void | Promise<void>;
}

/** Preview consumers may inject another engine; the application uses lazy Leaflet. */
export type MapRendererFactory = (
	container: HTMLElement, initialScene: MapScene, events: MapRendererEvents
) => MapRenderer | Promise<MapRenderer>;
