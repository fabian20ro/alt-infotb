import type { Station, StationWithDistance } from './types.js';

export interface LatLngBounds {
	south: number;
	north: number;
	west: number;
	east: number;
}

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

/** Haversine distance between two coordinates in meters */
export function distanceMeters(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number
): number {
	const dLat = (lat2 - lat1) * DEG_TO_RAD;
	const dLon = (lon2 - lon1) * DEG_TO_RAD;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * DEG_TO_RAD) *
			Math.cos(lat2 * DEG_TO_RAD) *
			Math.sin(dLon / 2) ** 2;
	return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the nearest N stations to a given coordinate.
 * Uses a bounding box pre-filter for performance.
 */
export function findNearestStations(
	lat: number,
	lon: number,
	stations: readonly Station[],
	count = 15
): StationWithDistance[] {
	// Pre-filter with bounding box (~2km ≈ 0.018 degrees latitude)
	// Start with a small radius and expand if we don't have enough
	let radiusDeg = 0.018;
	let candidates: Station[] = [];

	while (candidates.length < count && radiusDeg < 0.2) {
		candidates = stations.filter(
			(s) =>
				Math.abs(s.lat - lat) < radiusDeg &&
				Math.abs(s.lon - lon) < radiusDeg
		);
		radiusDeg *= 2;
	}

	// Calculate distances for candidates
	const withDistance: StationWithDistance[] = candidates.map((s) => ({
		...s,
		distanceMeters: distanceMeters(lat, lon, s.lat, s.lon)
	}));

	// Sort by distance and take top N
	withDistance.sort((a, b) => a.distanceMeters - b.distanceMeters);
	return withDistance.slice(0, count);
}

/**
 * Find stations within a geographic bounding box.
 * If more than `maxCount` stations fall within bounds, returns the nearest
 * to the center (by squared Euclidean distance — accurate at city scale).
 * The selected station is always included regardless of cap.
 */
export function findStationsInBounds(
	bounds: LatLngBounds,
	stations: readonly Station[],
	maxCount: number,
	selectedId?: number | null
): Station[] {
	const { south, north, west, east } = bounds;

	const inBounds = stations.filter(
		(s) => s.lat >= south && s.lat <= north && s.lon >= west && s.lon <= east
	);

	if (inBounds.length <= maxCount) {
		// Under cap — include selected even if outside bounds
		if (selectedId != null && !inBounds.some((s) => s.id === selectedId)) {
			const selected = stations.find((s) => s.id === selectedId);
			if (selected) return [...inBounds, selected];
		}
		return inBounds;
	}

	// Over cap — sort by squared Euclidean distance to center
	const centerLat = (south + north) / 2;
	const centerLon = (west + east) / 2;

	const sorted = [...inBounds].sort((a, b) => {
		const da = (a.lat - centerLat) ** 2 + (a.lon - centerLon) ** 2;
		const db = (b.lat - centerLat) ** 2 + (b.lon - centerLon) ** 2;
		return da - db;
	});

	const result = sorted.slice(0, maxCount);

	// Ensure selected station is included
	if (selectedId != null && !result.some((s) => s.id === selectedId)) {
		const selected = stations.find((s) => s.id === selectedId);
		if (selected) {
			result[result.length - 1] = selected; // replace farthest
		}
	}

	return result;
}
