import { API } from './constants.js';

/**
 * Fetch binary data from the STB API.
 * The API returns Protocol Buffers, so we read as ArrayBuffer.
 */
/** Human-readable hints for specific API status codes. */
const STATUS_HINTS = new Map<number, string>([
	[400, ' (Bad Request)'],
	[401, ' (Check auth token/proxy configuration)'],
	[403, ' (Check auth token/proxy configuration)'],
	[412, ' (Token expired, check proxy retry)'],
	[429, ' (Too many requests)'],
	[500, ' (Internal Server Error)'],
	[502, ' (Bad Gateway)'],
	[503, ' (Service Unavailable)'],
	[504, ' (Gateway Timeout)']
]);

export async function apiFetchBinary(url: string): Promise<Uint8Array> {
	if (typeof url !== 'string') {
		throw new ApiError('Invalid request URL', 0);
	}

	const trimmed = url.trim();
	if (!trimmed.length) {
		throw new ApiError('Invalid request URL', 0);
	}

	// Reject URLs with embedded control characters (tabs, newlines, etc.)
	// The `URL` constructor and `fetch()` silently strip leading/trailing whitespace,
	// but internal whitespace can produce malformed requests that fail obscurely.
	const controlCharPattern = /[	\n\r\f\v\0]/;
	if (controlCharPattern.test(url)) {
		throw new ApiError('Invalid request URL', 0);
	}

	const urlPattern = /^(https?:\/\/|\/)/;
	if (!urlPattern.test(trimmed)) {
		throw new ApiError('Invalid request URL', 0);
	}

	try {
		const parsed = new URL(trimmed, 'http://localhost');
		if (!parsed.hostname) {
			throw new ApiError('URL is missing a hostname', 0);
		}
		const hostnamePattern = /^[a-zA-Z0-9.-]+$/;
		if (!hostnamePattern.test(parsed.hostname)) {
			throw new ApiError(`Hostname contains invalid characters: "${parsed.hostname}"`, 0);
		}
	} catch (err) {
		if (err instanceof ApiError) throw err;
		throw new ApiError('Invalid request URL', 0);
	}

	try {
		const response = await fetch(trimmed, {
			headers: API.HEADERS,
			signal: AbortSignal.timeout(API.TIMEOUT)
		});

		if (!response.ok) {
			let hint = STATUS_HINTS.get(response.status) ?? '';
			// For rate-limit errors, include Retry-After header if present
			if (response.status === 429 && response.headers?.has('retry-after')) {
				const retryAfter = response.headers.get('retry-after')!;
				hint += `, retry in ${retryAfter}`;
			}
			throw new ApiError(`HTTP ${response.status}${hint}`, response.status);
		}

		const contentType = response.headers?.get('content-type');
		if (contentType) {
			const lowerCt = contentType.toLowerCase();
			const jsonPattern = /json\b/i;
			const textPattern = /^text\//i;
			if ((jsonPattern.test(lowerCt) && !lowerCt.includes('x-protobuf')) || textPattern.test(lowerCt)) {
				throw new ApiError(`Unexpected content type: ${contentType}`, 0);
			}
		}

		const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB hard cap on response body

		const buf = await response.arrayBuffer();
		if (!(buf instanceof ArrayBuffer)) {
			throw new ApiError('Response data unavailable: invalid buffer type', 0);
		}
		if (buf.byteLength > MAX_RESPONSE_BYTES) {
			throw new ApiError(`Response exceeds maximum size (${MAX_RESPONSE_BYTES} bytes)`, 0);
		}
		const copy = new Uint8Array(buf.byteLength);
		copy.set(new Uint8Array(buf));
		return copy;
	} catch (err) {
		if (err instanceof ApiError) throw err;
		if (err instanceof DOMException) {
			if (err.name === 'AbortError') throw new ApiError('Request aborted', 0);
			if (err.name === 'TimeoutError') throw new ApiError('Request timeout', 0);
		}
		if (err instanceof TypeError) {
			throw new ApiError('Network error (CORS or connectivity)', 0);
		}
		if (err instanceof Error) {
			throw new ApiError(`Response data unavailable: ${err.message}`, 0);
		}
		if (typeof err === 'object' && err !== null) {
			const obj = err as { message?: unknown };
			const msg = typeof obj.message === 'string' ? String(obj.message) : 'unexpected error type';
			throw new ApiError(`Response data unavailable: ${msg}`, 0);
		}
		throw new ApiError(String(err), 0);
	}
}

export class ApiError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
		this.name = 'ApiError';
	}
}
