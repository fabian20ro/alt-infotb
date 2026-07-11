export interface Station {
	id: number;
	name: string;
	description: string;
	lat: number;
	lon: number;
}

export interface StationWithDistance extends Station {
	distanceMeters: number;
	lastRefreshAt?: number;
}
