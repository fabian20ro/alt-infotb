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

/**
 * STB API authentication and header configuration (server-side only).
 * These headers trigger CORS preflight failures when sent from a browser,
 * so they're injected by the Vite dev proxy and Cloudflare Worker instead.
 */
export const STB_AUTH = {
	APP_ID: 'b32cc233-00d7-4640-bf90-374572668c30',
	APP_KEY: 'gcALgRyZHC,qFonZ=Jde',
	AUTH_PATH: '/proxy/user/auth'
} as const;

export const STB_SERVER_HEADERS: Record<string, string> = {
	'App-Id': STB_AUTH.APP_ID,
	'App-Version': '0.0.0',
	'Device-Name': 'Chrome',
	Lang: 'ro',
	'OS-Type': 'Web',
	'OS-Version': 'web',
	Source: 'ro.radcom.smartcity.web'
};

/**
 * Resolve the API base URL based on environment:
 * - Dev: `/stb-api` (proxied by Vite, no CORS issues)
 * - Production: `VITE_STB_API_BASE` env var (Cloudflare Worker URL)
 * - Fallback: direct STB URL (will fail from browser due to CORS/400)
 */
function resolveApiBase(): string {
	if (typeof import.meta !== 'undefined' && import.meta.env) {
		if (import.meta.env.DEV) return '/stb-api';
		if (import.meta.env.VITE_STB_API_BASE) return import.meta.env.VITE_STB_API_BASE;
	}
	return 'https://info.stb.ro/api/web/v2-6';
}

/** STB API configuration */
export const API = {
	BASE: resolveApiBase(),
	TIMEOUT: 10_000,
	/** Browser never sends custom headers — the proxy injects them server-side */
	HEADERS: {} as Record<string, string>
} as const;

/** Auto-refresh interval in milliseconds */
export const AUTO_REFRESH_INTERVAL = 30_000;

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
 *   9 = arrival entries (repeated sub-message)
 *
 * Arrival sub-message (ArrivalEntry):
 *   1 = is_scheduled flag (varint, 0=real-time, 1=estimated)
 *   2 = seconds until arrival (varint)
 */
export const PROTO_FIELDS = {
	STOP: { NAME: 1, ADDRESS: 2, TYPE: 5, LINES: 10 },
	LINE: { NAME: 1, ID: 2, VEHICLE_TYPE: 3, COLOR: 4, DIRECTION: 5, ARRIVALS: 9 },
	ARRIVAL: { IS_SCHEDULED: 1, SECONDS: 2 }
} as const;
