import type { Station } from './types.js';
import bundledCatalog from './stations.json';

interface BundledStationCatalog {
	feedVersion: string;
	sourceUpdatedAt: string;
	stations: Station[];
}

const catalog = bundledCatalog as BundledStationCatalog;

export const stationCatalogMetadata = {
	feedVersion: catalog.feedVersion,
	sourceUpdatedAt: catalog.sourceUpdatedAt
} as const;

/** Bucharest metro coordinate bounds for validating catalog stations. */
const BUCHAREST_BOUNDS = {
	latMin: 44.2,
	latMax: 44.7,
	lonMin: 25.6,
	lonMax: 26.4
} as const;

/** The catalog is bundled and precached by the PWA; no second browser cache is needed. */
export function loadStations(): Station[] {
	const validated = catalog.stations.filter((station) => {
		if (station.lat < BUCHAREST_BOUNDS.latMin || station.lat > BUCHAREST_BOUNDS.latMax) {
			console.warn(`Station ${station.id} has invalid latitude: ${station.lat}`);
			return false;
		}
		if (station.lon < BUCHAREST_BOUNDS.lonMin || station.lon > BUCHAREST_BOUNDS.lonMax) {
			console.warn(`Station ${station.id} has invalid longitude: ${station.lon}`);
			return false;
		}
		return true;
	});

	if (validated.length !== catalog.stations.length) {
		console.warn(
			`Filtered out ${catalog.stations.length - validated.length} stations with invalid coordinates from TPBI catalog v${catalog.feedVersion}`
		);
	}

	return [...validated];
}
