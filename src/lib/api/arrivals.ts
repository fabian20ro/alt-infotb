import { apiFetchBinary, ApiError } from './client.js';
import { API, PROTO_FIELDS, MAX_ARRIVAL_SECONDS, MAX_ARRIVALS_PER_LINE } from './constants.js';
import {
	ProtoReader,
	ProtoParseError,
	getString,
	getVarint,
	getMessages,
	getFixed64Double
} from './proto.js';
import type {
	StationArrivals,
	ArrivalInfo,
	LineDirection,
	LineSelectionRequest,
	RoutePoint,
	VehiclePosition
} from './types.js';

/** Sort arrivals by line name numerically, falling back to locale comparison */
function sortByLineName(arrivals: ArrivalInfo[]): void {
	arrivals.sort((a, b) => {
		const aNum = parseInt(a.lineName, 10);
		const bNum = parseInt(b.lineName, 10);
		if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
		return a.lineName.localeCompare(b.lineName);
	});
}

/** Format seconds-to-arrival into short human text (ro-RO). */
export function formatArrivalTime(seconds: number): string {
	if (seconds < 30) return 'acum';
	const totalMinutes = Math.round(seconds / 60);
	if (totalMinutes <= 59) return `${totalMinutes} min`;
	const hours = Math.floor(totalMinutes / 60);
	const mins = totalMinutes % 60;
	// Cap at ~24h to avoid misleading display for stale/bad data.
	// The STB API never returns values beyond MAX_ARRIVAL_SECONDS (2880).
	if (hours >= 48) return 'peste o zi';
	const hourWord = hours === 1 ? 'oră' : 'ore';
	if (mins === 0) return `${hours} ${hourWord}`;
	return `${hours} ${hourWord}, ${mins} min`;
}

/** Format a Date to HH:MM in ro-RO locale. */
export function formatTime(date: Date): string {
	return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

/** Decode a standard Google encoded polyline into latitude/longitude points. */
export function decodePolyline(encoded: string): RoutePoint[] {
	const points: RoutePoint[] = [];
	let index = 0;
	let latitude = 0;
	let longitude = 0;

	const readDelta = (): number => {
		let result = 0;
		let shift = 0;
		let byte: number;
		do {
			if (index >= encoded.length) throw new ProtoParseError('Invalid encoded route path');
			byte = encoded.charCodeAt(index++) - 63;
			if (byte < 0 || byte > 63) throw new ProtoParseError('Invalid encoded route path');
			result |= (byte & 0x1f) << shift;
			shift += 5;
			if (shift > 30) throw new ProtoParseError('Encoded route path delta is too large');
		} while (byte >= 0x20);
		return result & 1 ? ~(result >> 1) : result >> 1;
	};

	while (index < encoded.length) {
		latitude += readDelta();
		longitude += readDelta();
		points.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
	}
	return points;
}

function decodeVehicle(data: Uint8Array): VehiclePosition | null {
	const { VEHICLE } = PROTO_FIELDS;
	const fields = new ProtoReader(data).readAllFields();
	const lat = getFixed64Double(fields, VEHICLE.LATITUDE, data);
	const lng = getFixed64Double(fields, VEHICLE.LONGITUDE, data);

	if (
		lat === undefined ||
		lng === undefined ||
		!Number.isFinite(lat) ||
		!Number.isFinite(lng) ||
		lat < -90 ||
		lat > 90 ||
		lng < -180 ||
		lng > 180
	) {
		return null;
	}

	return {
		id: getVarint(fields, VEHICLE.ID) ?? 0,
		lat,
		lng,
		vehicleType: getString(fields, VEHICLE.VEHICLE_TYPE) ?? '',
		accessible: (getVarint(fields, VEHICLE.ACCESSIBLE) ?? 0) !== 0
	};
}

/**
 * Decode the protobuf response from the STB stop endpoint.
 * Reads field 9 repeated sub-messages for arrival times; field 8 is direction.
 * See docs/proto-analysis.md for the schema.
 */
export function decodeStopResponse(data: Uint8Array, sourceStopId: number): StationArrivals {
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
		const rawDirectionId = getVarint(lineFields, LINE.DIRECTION_ID);
		const directionId: LineDirection = rawDirectionId === 1 ? 1 : 0;
		const encodedPath = getString(lineFields, LINE.ENCODED_PATH) ?? '';
		const path = encodedPath ? decodePolyline(encodedPath) : [];
		const vehicles = getMessages(lineFields, LINE.VEHICLES)
			.map(decodeVehicle)
			.filter((vehicle): vehicle is VehiclePosition => vehicle !== null);

		// Extract arrival times from field 9 sub-messages
		const arrivalMessages = getMessages(lineFields, LINE.ARRIVALS);
		const times: number[] = [];

		for (const arrivalData of arrivalMessages) {
			const arrivalReader = new ProtoReader(arrivalData);
			const arrivalFields = arrivalReader.readAllFields();
			const seconds = getVarint(arrivalFields, ARRIVAL.SECONDS);
			if (seconds !== undefined && seconds >= 0 && seconds <= MAX_ARRIVAL_SECONDS) {
				times.push(seconds);
			}
		}

		const uniqueTimes = Array.from(new Set(times)).sort((a, b) => a - b);

		arrivals.push({
			lineName,
			lineId,
			vehicleType,
			color,
			direction,
			directionId,
			sourceStopId,
			arrivingTimes: uniqueTimes.slice(0, MAX_ARRIVALS_PER_LINE),
			encodedPath,
			path,
			vehicles
		});
	};

	sortByLineName(arrivals);

	return {
		stationName,
		address,
		arrivals,
		fetchedAt: new Date()
	};
}

/** Fetch arrivals from the STB API for a single stop. */
async function fetchSingleStop(
	stopId: number,
	selection?: LineSelectionRequest
): Promise<StationArrivals> {
	const params = new URLSearchParams({ stop_id: String(stopId) });
	if (selection) {
		params.set('selected_line_id', String(selection.lineId));
		params.set('direction', String(selection.directionId));
	}
	const url = `${API.BASE}/lines/stop?${params.toString()}`;

	try {
		const data = await apiFetchBinary(url);
		return decodeStopResponse(data, stopId);
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
	const originalValues = new Map<string, string>();
	for (const value of values) {
		if (!value.trim()) continue;
		const normalized = value.normalize('NFC');
		const count = (counts.get(normalized) ?? 0) + 1;
		counts.set(normalized, count);
		if (!originalValues.has(normalized)) {
			originalValues.set(normalized, value);
		}
	}
	let best = '';
	let bestCount = 0;
	counts.forEach((count, normalized) => {
		if (count > bestCount) {
			bestCount = count;
			best = originalValues.get(normalized)!;
		}
	});
	return best;
}

function mergeArrivals(results: StationArrivals[]): StationArrivals {
	const stationName = mostCommonNonEmpty(results.map((r) => r.stationName)) || results[0].stationName;
	const address = mostCommonNonEmpty(results.map((r) => r.address)) || results[0].address;

	const byLineKey = new Map<string, ArrivalInfo>();
	for (const arrival of results.flatMap((r) => r.arrivals)) {
		const key = `${arrival.lineName}|${arrival.direction}|${arrival.directionId}|${arrival.vehicleType}|${arrival.lineId}`;
		const existing = byLineKey.get(key);
		if (!existing) {
			byLineKey.set(key, {
				...arrival,
				arrivingTimes: [...arrival.arrivingTimes],
				path: [...arrival.path],
				vehicles: [...arrival.vehicles]
			});
			continue;
		}
		const mergedTimes = Array.from(new Set([...existing.arrivingTimes, ...arrival.arrivingTimes])).sort((a, b) => a - b);
		existing.arrivingTimes = mergedTimes.slice(0, MAX_ARRIVALS_PER_LINE);
		if (arrival.encodedPath || arrival.vehicles.length > 0) {
			existing.sourceStopId = arrival.sourceStopId;
			existing.encodedPath = arrival.encodedPath;
			existing.path = [...arrival.path];
			existing.vehicles = [...arrival.vehicles];
		}
	}

	const arrivals = Array.from(byLineKey.values());
	sortByLineName(arrivals);

	const fetchedAt = results.reduce(
		(min, r) => (r.fetchedAt < min ? r.fetchedAt : min),
		results[0].fetchedAt
	);

	return {
		stationName,
		address,
		arrivals,
		fetchedAt
	};
}

/**
 * Fetch arrivals from the STB API for the given stop(s).
 * Accepts a single stop ID or an array of stop IDs (for metro stations with
 * multiple platforms). When given an array, fetches all in parallel and merges
 * the results. Partial failures are tolerated — if some stops fail, the
 * successful results are still returned.
 */
function validateSelection(selection: LineSelectionRequest, stopIds?: number[]): void {
	if (!Number.isInteger(selection.sourceStopId) || selection.sourceStopId <= 0) {
		throw new ApiError('ID-ul stației sursă trebuie să fie un număr pozitiv', 0);
	}
	if (!Number.isInteger(selection.lineId) || selection.lineId <= 0) {
		throw new ApiError('ID-ul liniei trebuie să fie un număr pozitiv', 0);
	}
	if (selection.directionId !== 0 && selection.directionId !== 1) {
		throw new ApiError('Direcția liniei trebuie să fie 0 sau 1', 0);
	}
	if (stopIds && !stopIds.includes(selection.sourceStopId)) {
		throw new ApiError('Stația sursă selectată nu face parte din stația curentă', 0);
	}
}

export async function fetchArrivals(
	stopIds: number | number[],
	selection?: LineSelectionRequest
): Promise<StationArrivals> {
	const ids = Array.isArray(stopIds) ? stopIds : [stopIds];

	if (ids.length === 0) {
		throw new ApiError('Nu au fost furnizate ID-uri de stații', 0);
	}

	for (const id of ids) {
		if (!Number.isInteger(id) || id <= 0) {
			throw new ApiError(`ID-ul stației trebuie să fie un număr pozitiv`, 0);
		}
	}
	if (selection) validateSelection(selection, ids);

	const settled = await Promise.allSettled(
		ids.map((id) => fetchSingleStop(id, id === selection?.sourceStopId ? selection : undefined))
	);
	if (selection) {
		const selectedIndex = ids.indexOf(selection.sourceStopId);
		const selectedResult = settled[selectedIndex];
		if (selectedResult.status === 'rejected') throw selectedResult.reason;
	}
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

/** Fetch one direction's selected-line payload for route/opposite-direction use. */
export async function fetchLineRoute(selection: LineSelectionRequest): Promise<ArrivalInfo | null> {
	validateSelection(selection);
	const response = await fetchSingleStop(selection.sourceStopId, selection);
	return response.arrivals.find(
		(arrival) =>
			arrival.lineId === selection.lineId && arrival.directionId === selection.directionId
	) ?? null;
}
