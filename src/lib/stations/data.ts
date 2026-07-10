import type { Station } from './types.js';
import { getStations, saveStations, getLastRefreshTime, updateLastRefreshTime } from './db.js';
import bundledStations from './stations.json';

/** Hour (0-23) in Romanian time after which a new "transit day" begins */
const DAY_BOUNDARY_HOUR = 4;

/** Formatter for Romanian timezone-aware date extraction */
const ROMANIAN_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
	timeZone: 'Europe/Bucharest',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	hour12: false
});

/**
 * Compute the "Romanian day number" for a timestamp.
 * A transit day starts at 4 AM Europe/Bucharest, not midnight.
 */
function getRomanianDayNumber(timestampMs: number): number {
	const parts = ROMANIAN_DATE_FORMATTER.formatToParts(new Date(timestampMs));
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
export function isNewRomanianDay(lastRefreshMs: number, nowMs = Date.now()): boolean {
	if (!lastRefreshMs) return true;
	return getRomanianDayNumber(nowMs) > getRomanianDayNumber(lastRefreshMs);
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
	try {
		const cached = await getStations();
		if (cached.length > 0) {
			// Check staleness in background — return promise so caller can await it
			return {
				stations: cached,
				refreshDone: checkAndRefresh().catch(() => {}),
			};
		}
	} catch {
		// IndexedDB not available (e.g., private browsing)
	}

	// Fall back to bundled data and persist for next load
	const stations = bundledStations as Station[];
	try {
		await saveStations(stations);
	} catch {
		// IndexedDB not available
	}

	return { stations, refreshDone: Promise.resolve() };
}

/**
 * Check if station data is stale and update the refresh timestamp.
 * Station data is bundled at build time via scripts/fetch-stations.ts.
 * Browser-side GTFS refresh is not implemented (requires ZIP parsing).
 */
async function checkAndRefresh(nowMs = Date.now()): Promise<void> {
	const lastRefresh = await getLastRefreshTime();
	if (!isNewRomanianDay(lastRefresh, nowMs)) return;
	await updateLastRefreshTime();
}
