/**
 * Cloudflare Worker proxy for the STB API.
 * Injects required headers (including auth token) that browsers can't send due to CORS.
 */

const STB_API_BASE = 'https://info.stb.ro/api/web/v2-6';

const STB_AUTH = {
	APP_ID: 'b32cc233-00d7-4640-bf90-374572668c30',
	APP_KEY: 'gcALgRyZHC,qFonZ=Jde',
	AUTH_PATH: '/proxy/user/auth'
} as const;

const STB_HEADERS: Record<string, string> = {
	'App-Id': STB_AUTH.APP_ID,
	'App-Version': '0.0.0',
	'Device-Name': 'Chrome',
	'Lang': 'ro',
	'OS-Type': 'Web',
	'OS-Version': 'web',
	'Source': 'ro.radcom.smartcity.web'
};

/** Allowed API paths (prevent open proxy abuse) */
const ALLOWED_PATHS = ['/lines/stop'];

const ALLOWED_ORIGINS = [
	'https://fabian20ro.github.io',
	/^http:\/\/localhost(:\d+)?$/
];

let cachedToken: string | null = null;

function isOriginAllowed(origin: string | null): boolean {
	if (!origin) return false;
	return ALLOWED_ORIGINS.some((allowed) =>
		typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
	);
}

function corsHeaders(origin: string | null): Record<string, string> {
	const headers: Record<string, string> = {
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400'
	};
	if (origin && isOriginAllowed(origin)) {
		headers['Access-Control-Allow-Origin'] = origin;
	}
	return headers;
}

async function fetchAuthToken(): Promise<string> {
	const res = await fetch(`${STB_API_BASE}${STB_AUTH.AUTH_PATH}`, {
		headers: { 'App-key': STB_AUTH.APP_KEY, 'App-Id': STB_AUTH.APP_ID }
	});
	if (!res.ok) {
		throw new Error(`Auth failed: ${res.status}`);
	}
	const json = (await res.json()) as { data: { userInfo: string } };
	return json.data.userInfo;
}

async function proxyToStb(path: string, token: string): Promise<Response> {
	return fetch(`${STB_API_BASE}${path}`, {
		headers: { ...STB_HEADERS, 'User-Info': token }
	});
}

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(origin)
			});
		}

		// Only allow GET requests
		if (request.method !== 'GET') {
			return new Response('Method not allowed', { status: 405 });
		}

		// Path whitelist: only allowed API paths
		const apiPath = url.pathname;
		const isAllowed = ALLOWED_PATHS.some((p) => apiPath.startsWith(p));
		if (!isAllowed) {
			return new Response('Not found', { status: 404 });
		}

		try {
			// Ensure we have an auth token
			if (!cachedToken) {
				cachedToken = await fetchAuthToken();
			}

			// Forward the request with full path + query string
			const targetPath = `${apiPath}${url.search}`;
			let stbResponse = await proxyToStb(targetPath, cachedToken);

			// Token expired — re-authenticate and retry once
			if (stbResponse.status === 412) {
				cachedToken = await fetchAuthToken();
				stbResponse = await proxyToStb(targetPath, cachedToken);
			}

			// Forward the response with CORS headers
			const responseHeaders = new Headers(stbResponse.headers);
			for (const [key, value] of Object.entries(corsHeaders(origin))) {
				responseHeaders.set(key, value);
			}

			return new Response(stbResponse.body, {
				status: stbResponse.status,
				headers: responseHeaders
			});
		} catch (err) {
			return new Response(
				`Proxy error: ${err instanceof Error ? err.message : String(err)}`,
				{
					status: 502,
					headers: { ...corsHeaders(origin), 'Content-Type': 'text/plain' }
				}
			);
		}
	}
};
