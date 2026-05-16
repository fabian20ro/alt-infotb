import { apiFetchBinary, ApiError } from './client.js';
import { API, PROTO_FIELDS } from './constants.js';
import { ProtoReader, ProtoParseError, getString, getVarint, getMessages } from './proto.js';
import type { StationArrivals, ArrivalInfo } from './types.js';

/** Sort arrivals by line name numerically, falling back to locale comparison */
function sortByLineName(arrivals: ArrivalInfo[]): void {
	arrivals.sort((a, b) => {
		const aNum = parseInt(a.lineName, 10);
		const bNum = parseInt(b.lineName, 10);
		if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
		return a.lineName.localeCompare(b.lineName);
	});
}

/**
 * Decode the protobuf response from the STB stop endpoint.
 * Reads field 9 repeated sub-messages for arrival times (not fields 6/7/8).
 * See docs/proto-analysis.md for the schema.
 */
function decodeStopResponse(data: Uint8Array): StationArrivals {
	const reader = new ProtoReader(data);
	const fields = reader.readAllFields();
	const { STOP, LINE, ARRIVAL } = PROTO_FIELDS;

	const stationName = getString(fields, STOP.NAME) ?? '';
	const address = getString(fields, STOP.ADDRESS) ?? '';

	const lineMessages = getMessages(fields, STOP.LINES);
	const arrivals: ArrivalInfo[] = [];

	for (const lineData of lineMessages) {
		const lineReader = new ProtoReader(lineData);
		const lineFields = lineReader.readAllFields();

		const lineName = getString(lineFields, LINE.NAME) ?? '';
		const lineId = getVarint(lineFields, LINE.ID) ?? 0;
		const vehicleType = getString(lineFields, LINE.VEHICLE_TYPE) ?? '';
		const color = getString(lineFields, LINE.COLOR) ?? '#888888';
		const direction = getString(lineFields, LINE.DIRECTION) ?? '';

		// Extract arrival times from field 9 sub-messages
		const arrivalMessages = getMessages(lineFields, LINE.ARRIVALS);
		const times: number[] = [];

		for (const arrivalData of arrivalMessages) {
			const arrivalReader = new ProtoReader(arrivalData);
			const arrivalFields = arrivalReader.readAllFields();
			const seconds = getVarint(arrivalFields, ARRIVAL.SECONDS);
			if (seconds !== undefined && seconds >= 0 && seconds <= 7200) {
				times.push(seconds);
			}
		}

		times.sort((a, b) => a - b);

		arrivals.push({
			lineName,
			lineId,
			vehicleType,
			color,
			direction,
			arrivingTimes: times.slice(0, 3)
		});
	}

	sortByLineName(arrivals);

	return {
		stationName,
		address,
		arrivals,
		fetchedAt: new Date()
	};
}

/** Fetch arrivals from the STB API for a single stop. */
async function fetchSingleStop(stopId: number): Promise<StationArrivals> {
	const url = `${API.BASE}/lines/stop?stop_id=${stopId}`;

	try {
		const data = await apiFetchBinary(url);
		return decodeStopResponse(data);
	} catch (err) {
		if (err instanceof ApiError) throw err;
		if (err instanceof ProtoParseError) {
			throw new ApiError('Date STB invalid (protobuf corrupt)', 0);
		}
		throw new ApiError(
			`Nu am putut contacta STB: ${err instanceof Error ? err.message : String(err)}`,
			0
		);
	}
}

/** Merge multiple StationArrivals into one, combining all lines and re-sorting. */
function mostCommonNonEmpty(values: string[]): string {
	const counts = new Map<string, number>();
	for (const value of values) {
		if (!value.trim()) continue;
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	let best = '';
	let bestCount = 0;
	counts.forEach((count, value) => {
		if (count > bestCount) {
			best = value;
			bestCount = count;
		}
	});
	return best;
}

function mergeArrivals(results: StationArrivals[]): StationArrivals {
	const stationName = mostCommonNonEmpty(results.map((r) => r.stationName)) || results[0].stationName;
	const address = mostCommonNonEmpty(results.map((r) => r.address)) || results[0].address;

	const byLineKey = new Map<string, ArrivalInfo>();
	for (const arrival of results.flatMap((r) => r.arrivals)) {
		const key = `${arrival.lineName}|${arrival.direction}|${arrival.vehicleType}`;
		const existing = byLineKey.get(key);
		if (!existing) {
			byLineKey.set(key, { ...arrival, arrivingTimes: [...arrival.arrivingTimes] });
			continue;
		}
		const mergedTimes = Array.from(new Set([...existing.arrivingTimes, ...arrival.arrivingTimes])).sort((a, b) => a - b);
		existing.arrivingTimes = mergedTimes.slice(0, 3);
	}

	const arrivals = Array.from(byLineKey.values());
	sortByLineName(arrivals);

	return {
		stationName,
		address,
		arrivals,
		fetchedAt: new Date()
	};
}

/**
 * Fetch arrivals from the STB API for the given stop(s).
 * Accepts a single stop ID or an array of stop IDs (for metro stations with
 * multiple platforms). When given an array, fetches all in parallel and merges
 * the results. Partial failures are tolerated — if some stops fail, the
 * successful results are still returned.
 */
export async function fetchArrivals(stopIds: number | number[]): Promise<StationArrivals> {
	const ids = Array.isArray(stopIds) ? stopIds : [stopIds];

	const settled = await Promise.allSettled(ids.map(fetchSingleStop));
	const successes = settled
		.filter((r): r is PromiseFulfilledResult<StationArrivals> => r.status === 'fulfilled')
		.map((r) => r.value);

	if (successes.length === 0) {
		// All failed — re-throw the first error
		const firstError = settled.find(
			(r): r is PromiseRejectedResult => r.status === 'rejected'
		);
		throw firstError?.reason ?? new ApiError('All subway stop fetches failed', 0);
	}

	return mergeArrivals(successes);
}
