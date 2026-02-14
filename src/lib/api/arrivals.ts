import { apiFetchBinary, ApiError } from './client.js';
import { API, STOP_ID, STATION_NAME, TRAM_LINES, LINE_ORDER, PROTO_FIELDS } from './constants.js';
import { ProtoReader, getString, getVarint, getMessages, getVarints } from './proto.js';
import type { StationArrivals, ArrivalInfo } from './types.js';

/**
 * Decode the protobuf response from the STB stop endpoint.
 */
function decodeStopResponse(data: Uint8Array): StationArrivals {
	const reader = new ProtoReader(data);
	const fields = reader.readAllFields();
	const { STOP, LINE } = PROTO_FIELDS;

	const stationName = getString(fields, STOP.NAME) ?? STATION_NAME;
	const address = getString(fields, STOP.ADDRESS) ?? '';

	const lineMessages = getMessages(fields, STOP.LINES);
	const arrivals: ArrivalInfo[] = [];

	for (const lineData of lineMessages) {
		const lineReader = new ProtoReader(lineData);
		const lineFields = lineReader.readAllFields();

		const lineName = getString(lineFields, LINE.NAME) ?? '';
		if (!TRAM_LINES.has(lineName)) continue;

		const lineId = getVarint(lineFields, LINE.ID) ?? 0;
		const vehicleType = getString(lineFields, LINE.VEHICLE_TYPE) ?? '';
		const color = getString(lineFields, LINE.COLOR) ?? '#BE1622';
		const direction = getString(lineFields, LINE.DIRECTION) ?? '';

		// Collect arrival times from candidate fields
		const times: number[] = [];
		for (const fieldNum of PROTO_FIELDS.ARRIVAL_TIME_FIELDS) {
			const vals = getVarints(lineFields, fieldNum);
			times.push(...vals);
		}

		// Filter to reasonable values (0-7200 seconds = up to 2 hours)
		const validTimes = times.filter((t) => t >= 0 && t <= 7200);
		validTimes.sort((a, b) => a - b);

		arrivals.push({
			lineName,
			lineId,
			vehicleType,
			color,
			direction,
			arrivingTimes: validTimes.slice(0, 3)
		});
	}

	// Sort by display order
	const order = new Map(LINE_ORDER.map((name, i) => [name, i]));
	arrivals.sort((a, b) => (order.get(a.lineName) ?? 99) - (order.get(b.lineName) ?? 99));

	return {
		stationName,
		address,
		arrivals,
		fetchedAt: new Date()
	};
}

/** Fetch arrivals from the STB API for the hardcoded stop. */
export async function fetchArrivals(): Promise<StationArrivals> {
	const url = `${API.BASE}/lines/stop?stop_id=${STOP_ID}`;

	try {
		const data = await apiFetchBinary(url);
		return decodeStopResponse(data);
	} catch (err) {
		if (err instanceof ApiError) throw err;
		throw new ApiError(
			`Nu am putut contacta STB: ${err instanceof Error ? err.message : String(err)}`,
			0
		);
	}
}
