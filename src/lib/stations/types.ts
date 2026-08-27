/**
 * A single station record from the bundled TPBI catalog (`stations.json`).
 * Records are static; the catalog-wide freshness is the global
 * `stationCatalogMetadata.sourceUpdatedAt` (ISO 8601), not a per-station value.
 */
export interface Station {
	/** TPBI stop id used to request live arrivals for this station. */
	id: number;
	name: string;
	description: string;
	/** Station latitude in decimal degrees. */
	lat: number;
	/** Station longitude in decimal degrees (note: the API layer names this `lng`). */
	lon: number;
}

/** A {@link Station} annotated with its distance from a reference coordinate. */
export interface StationWithDistance extends Station {
	/** Haversine distance from the reference coordinate, in meters. */
	distanceMeters: number;
}
