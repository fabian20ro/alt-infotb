import { API } from './constants.js';

/**
 * Fetch binary data from the STB API.
 * The API returns Protocol Buffers, so we read as ArrayBuffer.
 */
export async function apiFetchBinary(url: string): Promise<Uint8Array> {
	if (!url || typeof url !== 'string' || !url.trim().length) {
		throw new ApiError('Invalid request URL', 0);
	}

	const urlPattern = /^(https?:\/\/|\/)/;
	if (!urlPattern.test(url)) {
		throw new ApiError('Invalid request URL', 0);
	}

	try {
		const parsed = new URL(url, 'http://localhost');
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			throw new Error('invalid protocol');
		}
		if (!parsed.hostname) {
			throw new Error('missing host');
		}
		const hostnamePattern = /^[a-zA-Z0-9.-]+$/;
		if (!hostnamePattern.test(parsed.hostname)) {
			throw new Error('invalid hostname');
		}
	} catch {
		throw new ApiError('Invalid request URL', 0);
	}

	try {
		const response = await fetch(url, {
			headers: API.HEADERS,
			signal: AbortSignal.timeout(API.TIMEOUT)
		});

		if (!response.ok) {
			const hint = response.status === 401 || response.status === 403
				? ' (Check auth token/proxy configuration)'
				: response.status === 412
				? ' (Token expired, check proxy retry)'
				: response.status === 400
				? ' (Bad Request)'
				: response.status === 429
				? ' (Too many requests)'
				: response.status === 503
				? ' (Service Unavailable)'
				: response.status === 504
				? ' (Gateway Timeout)'
				: response.status === 500
				? ' (Internal Server Error)'
				: '';
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
		return new Uint8Array(buf);
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