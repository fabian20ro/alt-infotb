import { apiFetch, ApiError } from './client.js';
import { API, STATION_NAME, TRAM_LINES } from './constants.js';
import type {
	StationArrivals,
	ArrivalInfo,
	MobiNextArrivalsResponse,
	StbLinesResponse,
	StbDirectionResponse
} from './types.js';

/**
 * Fetch arrival times using the mo-bi.ro nextArrivals API.
 * This is the preferred method as it returns all lines at a station.
 */
async function fetchFromMobi(stationId: string): Promise<StationArrivals> {
	const data = await apiFetch<MobiNextArrivalsResponse>(
		`${API.MOBI_BASE}/nextArrivals/${stationId}`
	);

	const arrivals: ArrivalInfo[] = [];
	const tramLineSet = new Set<string>(TRAM_LINES);

	if (data.lines) {
		for (const line of data.lines) {
			const name = String(line.name);
			if (!tramLineSet.has(name)) continue;

			const times: number[] = [];
			if (line.arrivingTime !== undefined && line.arrivingTime !== null) {
				times.push(line.arrivingTime);
			}
			if (line.arrivingTimes) {
				times.push(...line.arrivingTimes);
			}

			arrivals.push({
				lineId: String(line.id),
				lineName: name,
				direction: String(line.direction),
				arrivingTimes: times
			});
		}
	}

	// Merge duplicate line names (same line, different directions or entries)
	const merged = mergeArrivals(arrivals);

	return {
		stationName: data.name || STATION_NAME,
		arrivals: merged,
		fetchedAt: new Date()
	};
}

/**
 * Discover line IDs and stop IDs from the STB API, then fetch arrivals.
 * Fallback method when mo-bi.ro is unavailable.
 */
async function fetchFromStb(): Promise<StationArrivals> {
	// Step 1: Get all lines
	const linesData = await apiFetch<StbLinesResponse>(`${API.STB_BASE}/lines/`);

	const tramLineSet = new Set<string>(TRAM_LINES);
	const matchedLines = linesData.lines.filter((l) => tramLineSet.has(l.name));

	if (matchedLines.length === 0) {
		throw new ApiError('Could not find tram lines 7, 27, 47 in API', 0);
	}

	const arrivals: ArrivalInfo[] = [];

	// Step 2: For each line, find Piața Unirii stop and get arrival times
	for (const line of matchedLines) {
		try {
			// Try both directions
			for (const dir of [0, 1]) {
				const dirData = await apiFetch<StbDirectionResponse>(
					`${API.STB_BASE}/lines/${line.id}/direction/${dir}`
				);

				const stop = dirData.stops?.find(
					(s) =>
						s.name.toLowerCase().includes('unirii') ||
						s.name.toLowerCase().includes('piata unirii') ||
						s.name.toLowerCase().includes('piața unirii')
				);

				if (stop) {
					// Fetch arrival times for this stop
					const stopData = await apiFetch<Record<string, unknown>>(
						`${API.STB_BASE}/lines/${line.id}/stops/${stop.id}`
					);

					const times: number[] = [];
					// The response format varies; try common patterns
					if (typeof stopData === 'object' && stopData !== null) {
						if ('arrivingTime' in stopData && typeof stopData.arrivingTime === 'number') {
							times.push(stopData.arrivingTime);
						}
						if ('lines' in stopData && Array.isArray(stopData.lines)) {
							for (const l of stopData.lines) {
								if (
									typeof l === 'object' &&
									l !== null &&
									'arrivingTime' in l &&
									typeof l.arrivingTime === 'number'
								) {
									times.push(l.arrivingTime);
								}
							}
						}
					}

					arrivals.push({
						lineId: String(line.id),
						lineName: line.name,
						direction: String(dir),
						arrivingTimes: times
					});
					break; // Found the stop in this direction
				}
			}
		} catch {
			// Skip this line if it fails, continue with others
		}
	}

	return {
		stationName: STATION_NAME,
		arrivals: mergeArrivals(arrivals),
		fetchedAt: new Date()
	};
}

/** Merge arrivals with the same line name into one entry */
function mergeArrivals(arrivals: ArrivalInfo[]): ArrivalInfo[] {
	const byName = new Map<string, ArrivalInfo>();

	for (const a of arrivals) {
		const existing = byName.get(a.lineName);
		if (existing) {
			existing.arrivingTimes.push(...a.arrivingTimes);
		} else {
			byName.set(a.lineName, { ...a, arrivingTimes: [...a.arrivingTimes] });
		}
	}

	// Sort times within each line, and sort lines by name
	const result = Array.from(byName.values());
	for (const a of result) {
		a.arrivingTimes.sort((x, y) => x - y);
		// Keep at most 3 arrival times
		a.arrivingTimes = a.arrivingTimes.slice(0, 3);
	}

	// Sort lines by the order defined in TRAM_LINES
	const order = new Map<string, number>(TRAM_LINES.map((name, i) => [name, i]));
	result.sort((a, b) => (order.get(a.lineName) ?? 99) - (order.get(b.lineName) ?? 99));

	return result;
}

/**
 * Main entry point: fetch arrivals using available APIs.
 * Tries mo-bi.ro first with known station IDs, then falls back to STB discovery.
 */
export async function fetchArrivals(stationId?: string): Promise<StationArrivals> {
	const errors: string[] = [];

	// Try mo-bi.ro API with provided or cached station IDs
	if (stationId) {
		try {
			return await fetchFromMobi(stationId);
		} catch (err) {
			errors.push(`mo-bi.ro (${stationId}): ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// Try well-known Piața Unirii station IDs for mo-bi.ro
	// These are common GTFS stop_ids found in Bucharest transit data
	const candidateIds = ['2071', '2072', '2073', '2074'];
	for (const id of candidateIds) {
		if (id === stationId) continue; // already tried
		try {
			const result = await fetchFromMobi(id);
			if (result.arrivals.length > 0) {
				// Cache this working ID
				try {
					localStorage.setItem('better-stb-station-id', id);
				} catch {
					// localStorage might not be available
				}
				return result;
			}
		} catch (err) {
			errors.push(`mo-bi.ro (${id}): ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// Fallback: STB API with runtime discovery
	try {
		return await fetchFromStb();
	} catch (err) {
		errors.push(`stbsa.ro: ${err instanceof Error ? err.message : String(err)}`);
	}

	throw new ApiError(
		`Nu am putut obține date de la niciun API.\n${errors.join('\n')}`,
		0
	);
}
