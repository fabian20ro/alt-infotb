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
	/** Scheduled GTFS membership in either direction, keyed as `VEHICLE_TYPE:lineName`. */
	lines?: string[];
	/** Authoritative STB line identities, unioned across both directions. */
	lineIds?: number[];
	/** Exact upstream platforms represented by this marker (metro may have several). */
	apiStopIds?: number[];
	/** Membership provenance; GTFS-only services remain explicitly supplemental. */
	membershipSource?: 'stb' | 'gtfs' | 'mixed';
}

/** A {@link Station} annotated with its distance from a reference coordinate. */
export interface StationWithDistance extends Station {
	/** Haversine distance from the reference coordinate, in meters. */
	distanceMeters: number;
}
