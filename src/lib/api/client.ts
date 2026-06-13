import { API } from './constants.js';

/**
 * Fetch binary data from the STB API.
 * The API returns Protocol Buffers, so we read as ArrayBuffer.
 */
export async function apiFetchBinary(url: string): Promise<Uint8Array> {
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

		const buf = await response.arrayBuffer();
		return new Uint8Array(buf);
	} catch (err) {
		if (err instanceof ApiError) throw err;
		if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
			throw new ApiError('Request timeout', 0);
		}
		throw new ApiError(
			err instanceof TypeError ? 'Network error (CORS or connectivity)' : String(err),
			0
		);
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
