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
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 401 })
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('HTTP 401 (Check auth token/proxy configuration)');
		await expect(promise).rejects.toMatchObject({ status: 401 });
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

	it('throws Network error if arrayBuffer fails', async () => {
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

	it('throws ApiError on timeout', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(
				new DOMException('The operation was aborted', 'AbortError')
			)
		);
		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('Request timeout');
		await expect(promise).rejects.toMatchObject({ status: 0 });
	});

	it('throws ApiError on AbortError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(
				new DOMException('The operation was aborted', 'AbortError')
			)
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow('Request timeout');
		await expect(promise).rejects.toMatchObject({ status: 0 });
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

	it('throws ApiError for unhandled DOMException', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(
				new DOMException('Specific error message', 'CustomError')
			)
		);

		const promise = apiFetchBinary('https://info.stb.ro/test');
		await expect(promise).rejects.toThrow(/Specific error message/);
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
});

describe('ApiError', () => {
	it('has name and status properties', () => {
		const err = new ApiError('test error', 404);
		expect(err.name).toBe('ApiError');
		expect(err.message).toBe('test error');
		expect(err.status).toBe(404);
		expect(err).toBeInstanceOf(Error);
	});
});
