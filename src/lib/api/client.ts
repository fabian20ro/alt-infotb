import { API } from './constants.js';

/** Fetch wrapper with timeout and error handling */
export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), API.TIMEOUT);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal
		});

		if (!response.ok) {
			throw new ApiError(`HTTP ${response.status}`, response.status);
		}

		return (await response.json()) as T;
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
