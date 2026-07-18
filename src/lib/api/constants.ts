/**
 * Hardcoded station and line configuration for Phase 1.
 *
 * Endpoint: GET https://info.stb.ro/api/web/v2-6/lines/stop?stop_id=3570
 * Response: Protocol Buffers binary
 * Stop ID 3570 = Piața Unirii (Bd. Regina Maria, Bucuresti)
 * Lines at this stop: 7, 27, 32, 47 (all TRAM)
 */

/** Stop ID for the STB API */
export const STOP_ID = 3570;

/**
 * STB API authentication path (server-side only).
 * Credentials (APP_ID, APP_KEY) must come from environment variables,
 * not hardcoded in source. See .env.example for required variables.
 */
export const STB_AUTH_PATH = '/proxy/user/auth';

/**
 * Build the headers required by the STB API (server-side only).
 * These trigger CORS preflight failures when sent from a browser,
 * so they're injected by the Vite dev proxy and Cloudflare Worker instead.
 */
export function createStbServerHeaders(appId: string): Record<string, string> {
	return {
		'App-Id': appId,
		'App-Version': '0.0.0',
		'Device-Name': 'Chrome',
		Lang: 'ro',
		'OS-Type': 'Web',
		'OS-Version': 'web',
		Source: 'ro.radcom.smartcity.web'
	};
}

function _resolveApiBase(): string {
	try {
		const env = (import.meta as any)?.env;
		if (env) {
			if (env.DEV) return '/stb-api';
			if (env.VITE_STB_API_BASE) return env.VITE_STB_API_BASE;
		} else {
			return 'https://info.stb.ro/api/web/v2-6';
		}
	} catch (e) {
		console.warn('_resolveApiBase: import.meta.env unavailable, falling back to hardcoded URL', e);
		return 'https://info.stb.ro/api/web/v2-6';
	}
	return 'https://info.stb.ro/api/web/v2-6';
}

/** STB API configuration */
export const API = {
	get BASE(): string { return _resolveApiBase(); },
	TIMEOUT: 10_000,
	/** Browser never sends custom headers — the proxy injects them server-side */
	HEADERS: {} as Record<string, string>
} as const;

/** Arrivals refresh interval in milliseconds */
export const ARRIVALS_REFRESH_INTERVAL = 20_000;
export const MAX_ARRIVAL_SECONDS = 7200;
export const MAX_ARRIVALS_PER_LINE = 3;

/**
 * Protobuf field numbers in the stop response.
 * Verified via scripts/dump-proto.ts on 2026-02-15.
 * See docs/proto-analysis.md for full evidence.
 *
 * Top-level message (StopResponse):
 *   1 = station name (string)
 *   2 = address (string)
 *   5 = type (string, e.g. "STATION")
 *   10 = line entries (repeated message)
 *
 * Line sub-message (LineEntry):
 *   1 = line name (string, e.g. "27")
 *   2 = line id (varint, e.g. 66)
 *   3 = vehicle type (string, e.g. "TRAM")
 *   4 = color (string, e.g. "#BE1622")
 *   5 = direction name (string, e.g. "Faur")
 *   6 = first arrival seconds (varint, redundant with arrivals[0])
 *   8 = route direction (varint, 0 or 1)
 *   9 = arrival entries (repeated sub-message)
 *   11 = standard Google encoded polyline (string, selected-line response)
 *   12 = live vehicles (repeated sub-message, selected-line response)
 *
 * Arrival sub-message (ArrivalEntry):
 *   1 = is_scheduled flag (varint, 0=real-time, 1=estimated)
 *   2 = seconds until arrival (varint)
 *
 * Vehicle sub-message (VehicleEntry):
 *   1 = vehicle id (varint)
 *   2 = latitude (fixed64 little-endian double)
 *   3 = longitude (fixed64 little-endian double)
 *   4 = vehicle type (string)
 *   5 = accessibility flag (varint)
 */
export const PROTO_FIELDS = {
	STOP: { NAME: 1, ADDRESS: 2, TYPE: 5, LINES: 10 },
	LINE: {
		NAME: 1,
		ID: 2,
		VEHICLE_TYPE: 3,
		COLOR: 4,
		DIRECTION: 5,
		DIRECTION_ID: 8,
		ARRIVALS: 9,
		ENCODED_PATH: 11,
		VEHICLES: 12
	},
	ARRIVAL: { IS_SCHEDULED: 1, SECONDS: 2 },
	VEHICLE: { ID: 1, LATITUDE: 2, LONGITUDE: 3, VEHICLE_TYPE: 4, ACCESSIBLE: 5 }
} as const;
