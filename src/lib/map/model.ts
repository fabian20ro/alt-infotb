import type { ArrivalInfo } from '../api/types.js';
import type { Station } from '../stations/types.js';
import { stationServesLine } from '../stations/data.js';
import { findStationsInBounds, type LatLngBounds } from '../stations/geo.js';

export interface MapPosition { lat: number; lon: number; accuracy: number }
export type MapTheme = 'light' | 'dark';
export type Basemap = MapTheme | 'satellite';
export type MapDirection = Pick<ArrivalInfo, 'lineName' | 'vehicleType' | 'direction' | 'color' | 'path' | 'vehicles'>;

export interface MapRouteOverlay {
	key: string;
	lineId: number;
	lineName: string;
	vehicleType: string;
	primary: MapDirection | null;
	opposite: MapDirection | null;
}

export interface RouteOverviewRequest { id: number; routeKey: string }

/** Transit identity stays in the scene, independent of the rendering engine. */
export interface MapSceneInput {
	allStations: readonly Station[];
	selectedStationId: number | null;
	userPosition: MapPosition | null;
	locationPermission: 'granted' | 'denied' | 'prompt';
	locationError: string | null;
	theme: MapTheme;
	route: MapRouteOverlay | null;
}

export interface MapScene extends MapSceneInput {
	readonly routeStationIds: ReadonlySet<number>;
}

export function createMapScene(input: MapSceneInput): MapScene {
	return {
		...input,
		routeStationIds: new Set(input.allStations
			.filter((station) => input.route && stationServesLine(station, input.route))
			.map((station) => station.id))
	};
}

/** The same density rule applies to every renderer, including both directions. */
export function visibleStations(scene: MapScene, bounds: LatLngBounds): Station[] {
	return findStationsInBounds(bounds, scene.allStations, 100, scene.selectedStationId, scene.routeStationIds);
}
