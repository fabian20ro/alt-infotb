import type { Station } from './types.js';
import { getStations, saveStations, getLastRefreshTime, updateLastRefreshTime } from './db.js';
import bundledStations from './stations.json';

const GTFS_URL = 'https://s3.transitpdf.com/files/uran/improved-gtfs-bucuresti.zip';

/** Hour (0-23) in Romanian time after which a new "transit day" begins */
const DAY_BOUNDARY_HOUR = 4;

/**
 * Compute the "Romanian day number" for a timestamp.
 * A transit day starts at 4 AM Europe/Bucharest, not midnight.
 * Two timestamps with different day numbers means we've crossed a 4 AM boundary.
 */
export function getRomanianDayNumber(timestampMs: number): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Europe/Bucharest',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		hour12: false
	}).formatToParts(new Date(timestampMs));

	const year = parseInt(parts.find((p) => p.type === 'year')!.value);
	const month = parseInt(parts.find((p) => p.type === 'month')!.value);
	const day = parseInt(parts.find((p) => p.type === 'day')!.value);
	const hour = parseInt(parts.find((p) => p.type === 'hour')!.value);

	// Use Date.UTC for a consistent, timezone-independent day count
	let dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);

	// Before the boundary hour, we're still in the "previous" transit day
	if (hour < DAY_BOUNDARY_HOUR) dayNumber -= 1;

	return dayNumber;
}

/**
 * Check if a new Romanian transit day has started since the last refresh.
 * A new day begins at 4 AM Europe/Bucharest time.
 */
export function isNewRomanianDay(lastRefreshMs: number): boolean {
	if (!lastRefreshMs) return true;
	return getRomanianDayNumber(Date.now()) > getRomanianDayNumber(lastRefreshMs);
}

/**
 * Load station data with the following priority:
 * 1. IndexedDB (cached, instant)
 * 2. Bundled stations.json (build-time fallback)
 *
 * After loading, checks staleness and triggers background refresh if needed.
 * Returns { stations, refreshDone } where refreshDone resolves when the
 * background check completes (callers can await it to re-read the timestamp).
 */
export async function loadStations(): Promise<{ stations: Station[]; refreshDone: Promise<void> }> {
	let stations: Station[];

	try {
		const cached = await getStations();
		if (cached.length > 0) {
			stations = cached;
			// Check staleness in background — return promise so caller can await it
			const refreshDone = checkAndRefresh().catch(() => {});
			return { stations, refreshDone };
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

	return { stations, refreshDone: Promise.resolve() };
}

/** Check if station data is stale and refresh in background */
async function checkAndRefresh(): Promise<void> {
	const lastRefresh = await getLastRefreshTime();

	if (!isNewRomanianDay(lastRefresh)) return;

	// Try to fetch fresh data
	const fresh = await fetchFreshStations();
	if (fresh.length > 0) {
		await saveStations(fresh);
	} else {
		// No fresh data available, but mark that we've verified today
		await updateLastRefreshTime();
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
		void blob;
		return [];
	} catch {
		return [];
	}
}
