/** ISO 8601 timestamp of when this station's data was last fetched. */
export interface Station {
	id: number;
	name: string;
	description: string;
	lat: number;
	lon: number;
}

export interface StationWithDistance extends Station {
	distanceMeters: number;
}
