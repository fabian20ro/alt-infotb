import type { Station } from '../stations/types.js';
import type { Basemap, MapScene } from './model.js';

export interface MapPoint { lat: number; lon: number }
export interface MapCamera extends MapPoint { zoom: number }
export type BasemapStatus = 'loading' | 'ready' | 'missing-key' | 'unavailable';

export interface MapRendererEvents {
	onStationSelect(station: Station): void;
	onBasemapStatus(status: BasemapStatus): void;
	onRetryCooldown(active: boolean): void;
	/** A blocked camera intent may be retried after an engine animation ends. */
	onCameraIdle(): void;
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
	destroy(): void;
}
