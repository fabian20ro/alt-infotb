import type { Station } from './types.js';
import bundledCatalog from './stations.json';
import { stationServesLine as servesLine, validateStations, type CatalogLineSelection } from './membership.ts';

interface BundledStationCatalog {
	feedVersion: string;
	sourceUpdatedAt: string;
	stations: Station[];
	stb?: { source: string; observedAt: string; contentHash: string; lineIds: number[] };
}

const catalog = bundledCatalog as BundledStationCatalog;
const authoritativeLineIds = new Set(catalog.stb?.lineIds ?? []);

/** Match catalog membership, never infer a stop from proximity to the route path. */
export function stationServesLine(
	station: Station,
	line: CatalogLineSelection
): boolean {
	return servesLine(station, line, authoritativeLineIds);
}

export const stationCatalogMetadata = {
	feedVersion: catalog.feedVersion,
	sourceUpdatedAt: catalog.sourceUpdatedAt,
	stb: catalog.stb
} as const;

/** The catalog is bundled and precached by the PWA; no second browser cache is needed. */
export function loadStations(): Station[] {
	const validated = validateStations(catalog.stations);

	if (validated.length !== catalog.stations.length) {
		console.warn(
			`Filtered out ${catalog.stations.length - validated.length} stations with invalid coordinates from TPBI catalog v${catalog.feedVersion}`
		);
	}

	return validated;
}
