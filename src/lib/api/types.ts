/** A single line's arrival info at a station */
export interface ArrivalInfo {
	lineName: string;
	lineId: number;
	vehicleType: string;
	color: string;
	direction: string;
	/** Arrival times in seconds from now */
	arrivingTimes: number[];
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
