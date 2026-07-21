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

/** The catalog is bundled and precached by the PWA; no second browser cache is needed. */
export function loadStations(): Station[] {
	return catalog.stations;
}
