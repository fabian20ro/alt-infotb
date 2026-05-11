import { API } from './constants.js';

/**
 * Fetch binary data from the STB API.
 * The API returns Protocol Buffers, so we read as ArrayBuffer.
 */
export async function apiFetchBinary(url: string): Promise<Uint8Array> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), API.TIMEOUT);

	try {
		const response = await fetch(url, {
			headers: API.HEADERS,
			signal: controller.signal
		});

		if (!response.ok) {
			const hint = response.status === 401 || response.status === 403
				? ' (Check auth token/proxy configuration)'
				: '';
			throw new ApiError(`HTTP ${response.status}${hint}`, response.status);
		}

		const buf = await response.arrayBuffer();
		return new Uint8Array(buf);
	} catch (err) {
		if (err instanceof ApiError) throw err;
		if (err instanceof DOMException && err.name === 'AbortError') {
			throw new ApiError('Request timeout', 0);
		}
		throw new ApiError(
			err instanceof TypeError ? 'Network error (CORS or connectivity)' : String(err),
			0
		);
	} finally {
		clearTimeout(timeout);
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
