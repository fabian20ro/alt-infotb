import type { Station } from './types.js';
import { getStations, saveStations, getLastRefreshTime } from './db.js';
import bundledStations from './stations.json';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const GTFS_URL = 'https://s3.transitpdf.com/files/uran/improved-gtfs-bucuresti.zip';

/**
 * Load station data with the following priority:
 * 1. IndexedDB (cached, instant)
 * 2. Bundled stations.json (build-time fallback)
 *
 * After loading, checks staleness and triggers background refresh if needed.
 */
export async function loadStations(): Promise<Station[]> {
	let stations: Station[];

	try {
		const cached = await getStations();
		if (cached.length > 0) {
			stations = cached;
			// Check staleness in background
			checkAndRefresh().catch(() => {});
			return stations;
		}
	} catch {
		// IndexedDB not available (e.g., private browsing)
	}

	// Fall back to bundled data
	stations = bundledStations as Station[];

	// Save bundled data to IndexedDB for next time
	try {
		await saveStations(stations);
	} catch {
		// IndexedDB not available
	}

	return stations;
}

/** Check if station data is stale and refresh in background */
async function checkAndRefresh(): Promise<void> {
	const lastRefresh = await getLastRefreshTime();
	const isStale = Date.now() - lastRefresh > STALE_THRESHOLD_MS;

	if (!isStale) return;

	// Background refresh — don't block the UI
	const fresh = await fetchFreshStations();
	if (fresh.length > 0) {
		await saveStations(fresh);
	}
}

/** Fetch fresh station data from GTFS source */
async function fetchFreshStations(): Promise<Station[]> {
	try {
		const response = await fetch(GTFS_URL);
		if (!response.ok) return [];

		const blob = await response.blob();
		// We can't easily parse a ZIP in the browser without a library.
		// For now, just return empty to skip the refresh.
		// The bundled data is updated at build time via scripts/fetch-stations.ts.
		// A future improvement could use a lighter data endpoint.
		return [];
	} catch {
		return [];
	}
}
