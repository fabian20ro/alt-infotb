/**
 * Hardcoded station and line configuration for Phase 1.
 *
 * These IDs are for the mo-bi.ro / TPBI GTFS system.
 * The stationId is the GTFS stop_id for the tram stop at Piața Unirii.
 *
 * To discover these IDs:
 * 1. Download GTFS data from https://gtfs.tpbi.ro/regional
 * 2. Search stops.txt for "Piata Unirii" entries
 * 3. Cross-reference with stop_times.txt for tram routes 7, 27, 47
 *
 * The app also supports runtime discovery via the info.stbsa.ro API.
 */

export const STATION_NAME = 'Piața Unirii';

/** Lines to display on the arrival board */
export const TRAM_LINES = ['7', '27', '47'] as const;

/** Colors for each tram line badge */
export const LINE_COLORS: Record<string, string> = {
	'7': '#e63946',
	'27': '#457b9d',
	'47': '#2a9d8f'
};

/** API base URLs */
export const API = {
	/** Primary: mo-bi.ro TPBI API (newer, has nextArrivals endpoint) */
	MOBI_BASE: 'https://maps.mo-bi.ro/api',
	/** Fallback: info.stbsa.ro STB API */
	STB_BASE: 'https://info.stbsa.ro/rp/api',
	/** Request timeout in milliseconds */
	TIMEOUT: 10_000
} as const;

/**
 * Known station IDs for Piața Unirii tram stops.
 * These may need updating if the GTFS data changes.
 * Set to null to trigger runtime discovery.
 */
export const KNOWN_STATION_IDS: string[] | null = null;

/** Auto-refresh interval in milliseconds */
export const AUTO_REFRESH_INTERVAL = 30_000;
