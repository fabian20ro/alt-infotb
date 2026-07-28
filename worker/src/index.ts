import { connect } from 'cloudflare:sockets';

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

const STB_API_HOST = 'info.stb.ro';
const STB_API_BASE = `https://${STB_API_HOST}/api/web/v2-6`;
const STB_AUTH_PATH = '/proxy/user/auth';
const DNS_OVER_HTTPS_URL =
	`https://cloudflare-dns.com/dns-query?name=${STB_API_HOST}&type=A&cd=1`;
const MAX_SOCKET_RESPONSE_BYTES = 5 * 1024 * 1024;

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

type ProxyErrorStage =
	| 'auth-fetch'
	| 'auth-http'
	| 'auth-response'
	| 'dns-connect'
	| 'dns-doh'
	| 'dns-parse'
	| 'dns-read'
	| 'dns-write'
	| 'upstream-fetch';

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
let resolvedOrigin: { ip: string; expiresAt: number } | null = null;

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

async function resolveStbOrigin(): Promise<string> {
	const now = Date.now();
	if (resolvedOrigin && resolvedOrigin.expiresAt > now) return resolvedOrigin.ip;

	const response = await fetch(DNS_OVER_HTTPS_URL, {
		headers: { Accept: 'application/dns-json' }
	});
	if (!response.ok) throw new ProxyError('dns-doh', response.status);

	let dns: { Answer?: Array<{ data?: unknown; TTL?: unknown; type?: unknown }> };
	try {
		dns = (await response.json()) as typeof dns;
	} catch {
		throw new ProxyError('dns-doh');
	}
	const answer = dns.Answer?.find(
		(item) =>
			item.type === 1 &&
			typeof item.data === 'string' &&
			item.data.split('.').length === 4 &&
			item.data.split('.').every((part) => {
				const octet = Number(part);
				return /^\d{1,3}$/.test(part) && octet >= 0 && octet <= 255;
			})
	);
	if (!answer || typeof answer.data !== 'string') {
		throw new ProxyError('dns-doh');
	}

	const ttlSeconds =
		typeof answer.TTL === 'number' && Number.isFinite(answer.TTL)
			? Math.max(60, Math.min(answer.TTL, 3600))
			: 300;
	resolvedOrigin = { ip: answer.data, expiresAt: now + ttlSeconds * 1000 };
	return answer.data;
}

function findHeaderEnd(bytes: Uint8Array): number {
	for (let index = 0; index <= bytes.length - 4; index += 1) {
		if (
			bytes[index] === 13 &&
			bytes[index + 1] === 10 &&
			bytes[index + 2] === 13 &&
			bytes[index + 3] === 10
		) {
			return index;
		}
	}
	return -1;
}

function decodeChunkedBody(bytes: Uint8Array): Uint8Array {
	const decoder = new TextDecoder();
	const chunks: Uint8Array[] = [];
	let offset = 0;
	let totalLength = 0;

	while (offset < bytes.length) {
		let lineEnd = -1;
		for (let index = offset; index < bytes.length - 1; index += 1) {
			if (bytes[index] === 13 && bytes[index + 1] === 10) {
				lineEnd = index;
				break;
			}
		}
		if (lineEnd < 0) throw new ProxyError('dns-parse');

		const sizeText = decoder.decode(bytes.subarray(offset, lineEnd)).split(';', 1)[0];
		if (!/^[0-9a-f]+$/i.test(sizeText)) throw new ProxyError('dns-parse');
		const chunkSize = Number.parseInt(sizeText, 16);
		if (!Number.isSafeInteger(chunkSize) || chunkSize < 0) {
			throw new ProxyError('dns-parse');
		}
		if (chunkSize === 0) break;

		const chunkStart = lineEnd + 2;
		const chunkEnd = chunkStart + chunkSize;
		if (
			chunkEnd + 2 > bytes.length ||
			bytes[chunkEnd] !== 13 ||
			bytes[chunkEnd + 1] !== 10
		) {
			throw new ProxyError('dns-parse');
		}

		const chunk = bytes.slice(chunkStart, chunkEnd);
		chunks.push(chunk);
		totalLength += chunk.length;
		offset = chunkEnd + 2;
	}

	const body = new Uint8Array(totalLength);
	let bodyOffset = 0;
	for (const chunk of chunks) {
		body.set(chunk, bodyOffset);
		bodyOffset += chunk.length;
	}
	return body;
}

function parseSocketResponse(bytes: Uint8Array): Response {
	const headerEnd = findHeaderEnd(bytes);
	if (headerEnd < 0) throw new ProxyError('dns-parse');

	const decoder = new TextDecoder();
	const headerText = decoder.decode(bytes.subarray(0, headerEnd));
	const [statusLine, ...headerLines] = headerText.split('\r\n');
	const statusMatch = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine);
	if (!statusMatch) throw new ProxyError('dns-parse');

	const headers = new Headers();
	for (const line of headerLines) {
		const separator = line.indexOf(':');
		if (separator <= 0) continue;
		headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
	}

	const encodedBody = bytes.subarray(headerEnd + 4);
	const transferCodings = headers
		.get('Transfer-Encoding')
		?.split(',')
		.map((value) => value.trim().toLowerCase());
	const body =
		transferCodings?.at(-1) === 'chunked'
			? decodeChunkedBody(encodedBody)
			: encodedBody;
	headers.delete('Connection');
	headers.delete('Keep-Alive');
	headers.delete('Transfer-Encoding');
	headers.set('Content-Length', String(body.length));

	return new Response(body, { status: Number(statusMatch[1]), headers });
}

async function readSocketResponse(readable: ReadableStream): Promise<Uint8Array> {
	const reader = readable.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;

	try {
		while (true) {
			let result: ReadableStreamReadResult<Uint8Array>;
			try {
				result = await reader.read();
			} catch {
				if (totalLength === 0) throw new ProxyError('dns-read');
				break;
			}
			if (result.done) break;
			const chunk = new Uint8Array(result.value);
			totalLength += chunk.length;
			if (totalLength > MAX_SOCKET_RESPONSE_BYTES) {
				throw new ProxyError('dns-read');
			}
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}

	const response = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		response.set(chunk, offset);
		offset += chunk.length;
	}
	return response;
}

async function fetchViaOriginSocket(
	path: string,
	headers: Record<string, string>
): Promise<Response> {
	for (const value of Object.values(headers)) {
		if (/[\r\n]/.test(value)) throw new ProxyError('dns-write');
	}
	const requestHeaders = Object.entries(headers)
		.map(([name, value]) => `${name}: ${value}`)
		.join('\r\n');
	const request =
		`GET /api/web/v2-6${path} HTTP/1.1\r\n` +
		`Host: ${STB_API_HOST}\r\n` +
		'Connection: close\r\n' +
		`${requestHeaders}\r\n\r\n`;

	const ip = await resolveStbOrigin();
	let tlsSocket: Socket;
	try {
		const socket = connect(
			{ hostname: ip, port: 443 },
			{ allowHalfOpen: true, secureTransport: 'starttls' }
		);
		tlsSocket = socket.startTls({ expectedServerHostname: STB_API_HOST });
		await tlsSocket.opened;
	} catch {
		throw new ProxyError('dns-connect');
	}
	try {
		const writer = tlsSocket.writable.getWriter();
		try {
			try {
				await writer.write(new TextEncoder().encode(request));
				await writer.close();
			} catch {
				throw new ProxyError('dns-write');
			}
		} finally {
			writer.releaseLock();
		}

		const bytes = await readSocketResponse(tlsSocket.readable);
		return parseSocketResponse(bytes);
	} finally {
		await tlsSocket.close().catch(() => undefined);
	}
}

async function fetchFromStb(
	path: string,
	headers: Record<string, string>
): Promise<Response> {
	const response = await fetch(`${STB_API_BASE}${path}`, { headers });
	if (response.status !== 530) return response;

	try {
		return await fetchViaOriginSocket(path, headers);
	} catch (error) {
		if (error instanceof ProxyError) throw error;
		throw new ProxyError('dns-connect');
	}
}

async function fetchAuthToken(appId: string, appKey: string): Promise<string> {
	let res: Response;
	try {
		res = await fetchFromStb(
			STB_AUTH_PATH,
			{ 'App-key': appKey, 'App-Id': appId }
		);
	} catch (error) {
		if (error instanceof ProxyError) throw error;
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
		return await fetchFromStb(path, { ...stbHeaders, 'User-Info': token });
	} catch (error) {
		if (error instanceof ProxyError) throw error;
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
