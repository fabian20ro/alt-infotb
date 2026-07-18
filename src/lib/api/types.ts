export type LineDirection = 0 | 1;

/** A decoded point from the line's Google encoded polyline. */
export interface RoutePoint {
	lat: number;
	lng: number;
}

/** A live vehicle position returned for the selected line. */
export interface VehiclePosition extends RoutePoint {
	id: number;
	vehicleType: string;
	accessible: boolean;
}

/** Identifies the exact stop/platform, line, and direction to expand. */
export interface LineSelectionRequest {
	sourceStopId: number;
	lineId: number;
	directionId: LineDirection;
}

/** A single line's arrival info at a station */
export interface ArrivalInfo {
	lineName: string;
	lineId: number;
	vehicleType: string;
	color: string;
	direction: string;
	/** Numeric direction required by the selected-line API request. */
	directionId: LineDirection;
	/** Exact API stop/platform that produced this line entry. */
	sourceStopId: number;
	/** Arrival times in seconds from now */
	arrivingTimes: number[];
	/** Raw standard Google encoded polyline; populated only for a selected line. */
	encodedPath: string;
	/** Decoded origin-to-terminal route path. */
	path: RoutePoint[];
	/** All live vehicles returned for this selected line and direction. */
	vehicles: VehiclePosition[];
}

/** Raw `StationArrivals` read back from localStorage (fetchedAt is a Date). */
export type DeserializedStationArrivals = Omit<StationArrivals, 'fetchedAt'> & { fetchedAt: string };

/** Convert raw deserialized data so callers always see a real `Date`. */
export const deserializeStationArrivals = (raw: DeserializedStationArrivals): StationArrivals => ({
	...raw,
	fetchedAt: new Date(raw.fetchedAt),
});

/** The full arrival response for a station.
 *  NOTE: `fetchedAt` is `Date` in the API layer (decodeStopResponse) but becomes
 *  `string` when deserialized from localStorage (getCachedArrivals). Callers that
 *  consume this field must handle both states — never pass raw data through JSON
 *  serialization without converting to Date first. */
export interface StationArrivals {
	stationName: string;
	address: string;
	arrivals: ArrivalInfo[];
	fetchedAt: Date;
}

export type ApiStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ArrivalsState {
	status: ApiStatus;
	data: StationArrivals | null;
	error: string | null;
}
