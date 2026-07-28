/**
 * Cloudflare Worker proxy for the STB API.
 * Injects required headers (including auth token) that browsers can't send due to CORS.
 *
 * Credentials (STB_APP_ID, STB_APP_KEY) must be set as Cloudflare secrets:
 *   wrangler secret put STB_APP_ID
 *   wrangler secret put STB_APP_KEY
 */

interface Env {
	STB_APP_ID: string;
	STB_APP_KEY: string;
}

const STB_API_BASE = 'https://info.stb.ro/api/web/v2-6';
const STB_AUTH_PATH = '/proxy/user/auth';

function createStbHeaders(appId: string): Record<string, string> {
	return {
		'App-Id': appId,
		'App-Version': '0.0.0',
		'Device-Name': 'Chrome',
		'Lang': 'ro',
		'OS-Type': 'Web',
		'OS-Version': 'web',
		'Source': 'ro.radcom.smartcity.web'
	};
}

/** Allowed API paths (prevent open proxy abuse) */
const ALLOWED_PATHS = ['/lines/stop'];

const ALLOWED_ORIGINS = [
	'https://fabian20ro.github.io'
];

interface TokenCacheEntry {
	token: string;
	fetchedAt: number;
}

type ProxyErrorStage = 'auth-fetch' | 'auth-http' | 'auth-response' | 'upstream-fetch';

class ProxyError extends Error {
	constructor(
		readonly stage: ProxyErrorStage,
		readonly upstreamStatus?: number
	) {
		super(`Proxy failed at ${stage}`);
	}
}

const TOKEN_TTL_MS = 50 * 60 * 1000;
const tokenCache = new Map<string, TokenCacheEntry>();

function isOriginAllowed(origin: string | null): boolean {
	if (!origin) return false;
	if (ALLOWED_ORIGINS.includes(origin)) return true;

	try {
		const url = new URL(origin);
		return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	} catch {
		return false;
	}
}

function corsHeaders(origin: string | null): Record<string, string> {
	const headers: Record<string, string> = {
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none';"
	};
	if (origin && isOriginAllowed(origin)) {
		headers['Access-Control-Allow-Origin'] = origin;
	}
	return headers;
}

async function fetchAuthToken(appId: string, appKey: string): Promise<string> {
	let res: Response;
	try {
		res = await fetch(`${STB_API_BASE}${STB_AUTH_PATH}`, {
			headers: { 'App-key': appKey, 'App-Id': appId }
		});
	} catch {
		throw new ProxyError('auth-fetch');
	}
	if (!res.ok) {
		throw new ProxyError('auth-http', res.status);
	}

	try {
		const json = (await res.json()) as { data?: { userInfo?: unknown } };
		if (typeof json.data?.userInfo !== 'string') {
			throw new ProxyError('auth-response');
		}
		return json.data.userInfo;
	} catch (error) {
		if (error instanceof ProxyError) throw error;
		throw new ProxyError('auth-response');
	}
}

async function proxyToStb(path: string, token: string, stbHeaders: Record<string, string>): Promise<Response> {
	try {
		return await fetch(`${STB_API_BASE}${path}`, {
			headers: { ...stbHeaders, 'User-Info': token }
		});
	} catch {
		throw new ProxyError('upstream-fetch');
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
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
			const stbHeaders = createStbHeaders(env.STB_APP_ID);

			// Ensure we have an auth token (cache scoped by App ID)
			const now = Date.now();
			const cached = tokenCache.get(env.STB_APP_ID);
			if (!cached || now - cached.fetchedAt > TOKEN_TTL_MS) {
				const token = await fetchAuthToken(env.STB_APP_ID, env.STB_APP_KEY);
				tokenCache.set(env.STB_APP_ID, { token, fetchedAt: now });
			}

			// Forward the request with full path + query string
			const targetPath = `${apiPath}${url.search}`;
			let stbResponse = await proxyToStb(targetPath, tokenCache.get(env.STB_APP_ID)!.token, stbHeaders);

			// Token expired — re-authenticate and retry once
			if (stbResponse.status === 412) {
				const token = await fetchAuthToken(env.STB_APP_ID, env.STB_APP_KEY);
				tokenCache.set(env.STB_APP_ID, { token, fetchedAt: Date.now() });
				stbResponse = await proxyToStb(targetPath, token, stbHeaders);
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
			const proxyError = err instanceof ProxyError ? err : null;
			console.error('Proxy error', {
				stage: proxyError?.stage ?? 'unexpected',
				upstreamStatus: proxyError?.upstreamStatus
			});
			const errorHeaders = {
				...corsHeaders(origin),
				'Content-Type': 'text/plain',
				'X-Proxy-Error': proxyError?.stage ?? 'unexpected',
				...(proxyError?.upstreamStatus
					? { 'X-Upstream-Status': String(proxyError.upstreamStatus) }
					: {})
			};
			return new Response(
				'Proxy error: Internal Server Error',
				{
					status: 502,
					headers: errorHeaders
				}
			);
		}
	}
};
