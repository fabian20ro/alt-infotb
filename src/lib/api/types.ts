/** A single line's arrival info at a station */
export interface ArrivalInfo {
	lineId: string;
	lineName: string;
	direction: string;
	/** Arrival times in seconds from now */
	arrivingTimes: number[];
}

/** The full arrival response for a station */
export interface StationArrivals {
	stationName: string;
	arrivals: ArrivalInfo[];
	fetchedAt: Date;
}

/** Response from maps.mo-bi.ro/api/nextArrivals/{stationId} */
export interface MobiNextArrivalsResponse {
	name: string;
	address: string;
	lines: MobiLineArrival[];
}

export interface MobiLineArrival {
	id: string | number;
	name: string;
	direction: number;
	arrivingTime?: number;
	/** Some responses include multiple times */
	arrivingTimes?: number[];
}

/** Response from info.stbsa.ro/rp/api/lines/ */
export interface StbLinesResponse {
	lines: StbLine[];
}

export interface StbLine {
	id: number;
	name: string;
	type: string;
	color?: string;
}

/** Response from info.stbsa.ro/rp/api/lines/:id/direction/:dir */
export interface StbDirectionResponse {
	id: number;
	name: string;
	direction: string;
	stops: StbStop[];
	segment_path?: string;
}

export interface StbStop {
	id: number;
	name: string;
	lat: number;
	lng: number;
}

/** Response from info.stbsa.ro/rp/api/lines/:id/stops/:stopId */
export interface StbStopArrivalsResponse {
	/** Arrival times in various formats */
	lines?: StbStopArrivalLine[];
	arrivingTime?: number;
	[key: string]: unknown;
}

export interface StbStopArrivalLine {
	id: number;
	name: string;
	arrivingTime: number;
	direction: number;
}

export type ApiStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ArrivalsState {
	status: ApiStatus;
	data: StationArrivals | null;
	error: string | null;
}
