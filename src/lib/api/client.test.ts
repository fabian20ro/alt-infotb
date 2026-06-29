import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetchBinary, ApiError } from './client.js';
import { API } from './constants.js';

describe('apiFetchBinary', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns Uint8Array on success', async () => {
		const mockData = new Uint8Array([0x0a, 0x02, 0x32, 0x37]);
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(mockData.buffer)
			})
		);

		const result = await apiFetchBinary('https://info.stb.ro/test');
		expect(result).toBeInstanceOf(Uint8Array);
		expect(result).toEqual(mockData);
	});

	it('returns empty Uint8Array for 204 No Content', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
			})
		);

		const result = await apiFetchBinary('https://info.stb.ro/test');
		expect(result).toBeInstanceOf(Uint8Array);
		expect(result.length).toBe(0);
	});

	it('uses exactly the headers from API.HEADERS', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
		});
		vi.stubGlobal('fetch', mockFetch);

		await apiFetchBinary('https://info.stb.ro/test');

		const [, options] = mockFetch.mock.calls[0];
		expect(options.headers).toEqual(API.HEADERS);
	});

	it('passes an abort signal to fetch', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
		});
		vi.stubGlobal('fetch', mockFetch);

		await apiFetchBinary('https://info.stb.ro/test');

		const [, options] = mockFetch.mock.calls[0];
		expect(options.signal).toBeInstanceOf(AbortSignal);
	});

	it('throws helpful error on 401 or 403', async () => {
		for (const status of [401, 403]) {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({ ok: false, status })
			);

			const promise = apiFetchBinary('https://info.stb.ro/test');
			await expect(promise).rejects.toThrow(`HTTP ${status} (Check auth token/proxy configuration)`);
			await expect(promise).rejects.toMatchObject({ status });
		}
	});

	it('throws helpful error on 412', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 412 })
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('HTTP 412 (Token expired, check proxy retry)');
		await expect(promise).rejects.toMatchObject({ status: 412 });
	});

	it('throws helpful error on 400', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 400 })
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('HTTP 400 (Bad Request)');
		await expect(promise).rejects.toMatchObject({ status: 400 });
	});

	it('throws helpful error on 429', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 429 })
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('HTTP 429 (Too many requests)');
		await expect(promise).rejects.toMatchObject({ status: 429 });
	});

	it('throws helpful error on 404', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 404 })
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('HTTP 404');
		await expect(promise).rejects.toMatchObject({ status: 404 });
	});

	it('throws helpful error on 503 or 504', async () => {
		const cases = [
			{ status: 503, expected: 'HTTP 503 (Service Unavailable)' },
			{ status: 504, expected: 'HTTP 504 (Gateway Timeout)' }
		];
		for (const { status, expected } of cases) {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({ ok: false, status })
			);
			const promise = apiFetchBinary('https://info.stb.ro/test');
			await expect(promise).rejects.toThrow(expected);
			await expect(promise).rejects.toMatchObject({ status });
		}
	});

	it('throws helpful error on 500', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 500 })
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('HTTP 500 (Internal Server Error)');
		await expect(promise).rejects.toMatchObject({ status: 500 });
	});

	it('throws ApiError on network failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow(ApiError);
		await expect(promise).rejects.toThrow('Network error (CORS or connectivity)');
		await expect(promise).rejects.toMatchObject({ status: 0 });
	});

	it('throws ApiError when arrayBuffer fails with TypeError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.reject(new TypeError('Failed to read buffer'))
			})
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('Network error (CORS or connectivity)');
		await expect(promise).rejects.toMatchObject({ status: 0 });
	});

	it('throws ApiError for AbortError and TimeoutError', async () => {
		for (const name of ['AbortError', 'TimeoutError'] as const) {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockRejectedValue(
					new DOMException('The operation was aborted', name)
				)
			);
			const promise = apiFetchBinary('https://info.stb.ro/test');
			const expectedError = name === 'AbortError' ? 'Request aborted' : 'Request timeout';
			await expect(promise).rejects.toThrow(expectedError);
			await expect(promise).rejects.toMatchObject({ status: 0 });
		}
	});

	it('throws generic error for unhandled status codes', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 418 })
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('HTTP 418');
		await expect(promise).rejects.toMatchObject({ status: 418 });
	});

	it('throws ApiError for generic Errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new Error('Unexpected error'))
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('Error: Unexpected error');
		await expect(promise).rejects.toMatchObject({ status: 0 });
	});

	it('uses API.TIMEOUT for the abort signal', async () => {
		const abortSignalSpy = vi.spyOn(AbortSignal, 'timeout');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
		}));

		await apiFetchBinary('https://info.stb.ro/test');

		expect(abortSignalSpy).toHaveBeenCalledWith(API.TIMEOUT);
	});

	it('wraps a generic Error in an ApiError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new Error('Unexpected error'))
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('Error: Unexpected error');
		await expect(promise).rejects.toMatchObject({ status: 0 });
	});

	it('throws ApiError when url is invalid (empty string)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
		);

		const promise = apiFetchBinary('');
		await expect(promise).rejects.toThrow('Network error (CORS or connectivity)');
		await expect(promise).rejects.toMatchObject({ status: 0 });
	});

	it('throws ApiError if arrayBuffer() fails with a non-TypeError Error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.reject(new Error('Buffer error'))
			})
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('Buffer error');
		await expect(promise).rejects.toMatchObject({ status: 0 });
	});

	it('wraps non-timeout DOMException in ApiError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(
				new DOMException('Some DOM error', 'NotSupportedError')
			)
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow(/Some DOM error/);
		await expect(promise).rejects.toMatchObject({ status: 0 });
	});
});
