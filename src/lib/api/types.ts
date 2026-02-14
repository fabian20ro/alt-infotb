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

/** The full arrival response for a station */
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
