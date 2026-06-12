import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetchBinary, ApiError } from './client.js';

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

	it('does not send custom headers that trigger CORS preflight', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
		});
		vi.stubGlobal('fetch', mockFetch);

		await apiFetchBinary('https://info.stb.ro/test');

		const [, options] = mockFetch.mock.calls[0];
		expect(options.headers['App-Id']).toBeUndefined();
		expect(options.headers['Lang']).toBeUndefined();
		expect(options.headers['Source']).toBeUndefined();
		expect(options.headers['Device-Name']).toBeUndefined();
	});

	it('throws helpful error on 401 or 403', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 401 })
		);

		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow(
			'HTTP 401 (Check auth token/proxy configuration)'
		);
	});

	it('throws helpful error on 412', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 412 })
		);

		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow(
			'HTTP 412 (Token expired, check proxy retry)'
		);
	});

	it('throws helpful error on 400', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 400 })
		);

		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow(
			'HTTP 400 (Bad Request)'
		);
	});

	it('throws helpful error on 429', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 429 })
		);

		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow(
			'HTTP 429 (Too many requests)'
		);
	});

	it('throws helpful error on 404', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 404 })
		);

		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow(
			'HTTP 404'
		);
	});

	it('throws helpful error on 500', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 500 })
		);

		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow(
			'HTTP 500 (Internal Server Error)'
		);
	});

	it('throws ApiError on network failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
		);

		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow(ApiError);
		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow(
			'Network error (CORS or connectivity)'
		);
	});

	it('throws ApiError on timeout', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(
				new DOMException('The operation was aborted', 'AbortError')
			)
		);

		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow('Request timeout');
	});
});

describe('apiFetchBinary Timeout', () => {
	it('throws ApiError on TimeoutError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'))
		);
		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow('Request timeout');
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
