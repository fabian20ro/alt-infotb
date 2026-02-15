import { apiFetchBinary, ApiError } from './client.js';
import { API, PROTO_FIELDS } from './constants.js';
import { ProtoReader, getString, getVarint, getMessages } from './proto.js';
import type { StationArrivals, ArrivalInfo } from './types.js';

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

	// Sort by line name numerically
	arrivals.sort((a, b) => {
		const aNum = parseInt(a.lineName, 10);
		const bNum = parseInt(b.lineName, 10);
		if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
		return a.lineName.localeCompare(b.lineName);
	});

	return {
		stationName,
		address,
		arrivals,
		fetchedAt: new Date()
	};
}

/** Fetch arrivals from the STB API for the given stop. */
export async function fetchArrivals(stopId: number): Promise<StationArrivals> {
	const url = `${API.BASE}/lines/stop?stop_id=${stopId}`;

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
