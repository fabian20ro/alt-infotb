/**
 * Hardcoded station and line configuration for Phase 1.
 *
 * Endpoint: GET https://info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570
 * Response: Protocol Buffers binary
 * Stop ID 3570 = Piața Unirii (Bd. Regina Maria, Bucuresti)
 * Lines at this stop: 7, 27, 32, 47 (all TRAM)
 */

export const STATION_NAME = 'Piața Unirii';

/** Stop ID for the STB API */
export const STOP_ID = 3570;

/** Lines to display on the arrival board */
export const TRAM_LINES = new Set(['7', '27', '47']);

/** Colors for each tram line badge (STB reports #BE1622 for all trams; we use distinct colors for readability) */
export const LINE_COLORS: Record<string, string> = {
	'7': '#e63946',
	'27': '#457b9d',
	'47': '#2a9d8f'
};

/** Display order for lines */
export const LINE_ORDER: string[] = ['7', '27', '47'];

/** STB API configuration */
export const API = {
	BASE: 'https://info.stb.ro/api/web/v2-6',
	TIMEOUT: 10_000,
	HEADERS: {
		'Accept': 'application/json',
		'App-Id': 'b32cc233-00d7-4640-bf90-374572668c30',
		'App-Version': '0.0.0',
		'Device-Name': 'Chrome',
		'Lang': 'ro',
		'Source': 'ro.radcom.smartcity.web'
	} as Record<string, string>
} as const;

/** Auto-refresh interval in milliseconds */
export const AUTO_REFRESH_INTERVAL = 30_000;

/**
 * Protobuf field numbers in the stop response.
 * Discovered by inspecting the binary response from the STB API.
 *
 * Top-level message:
 *   1 = station name (string)
 *   2 = address (string)
 *   5 = type (string, e.g. "STATION")
 *   10 = line entries (repeated message)
 *
 * Line sub-message:
 *   1 = line name (string, e.g. "27")
 *   2 = line id (varint, e.g. 66)
 *   3 = vehicle type (string, e.g. "TRAM")
 *   4 = color (string, e.g. "#BE1622")
 *   5 = direction name (string, e.g. "Faur")
 *   6 = first arrival time in seconds (varint)
 *   7 = second arrival time in seconds (varint)
 *   8 = third arrival time in seconds (varint)
 */
export const PROTO_FIELDS = {
	STOP: { NAME: 1, ADDRESS: 2, TYPE: 5, LINES: 10 },
	LINE: { NAME: 1, ID: 2, VEHICLE_TYPE: 3, COLOR: 4, DIRECTION: 5 },
	/** Candidate field numbers for arrival times (will try in order) */
	ARRIVAL_TIME_FIELDS: [6, 7, 8]
} as const;
