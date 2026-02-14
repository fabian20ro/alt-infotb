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

	it('sends correct headers', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
		});
		vi.stubGlobal('fetch', mockFetch);

		await apiFetchBinary('https://info.stb.ro/test');

		const [, options] = mockFetch.mock.calls[0];
		expect(options.headers['App-Id']).toBe('b32cc233-00d7-4640-bf90-374572668c30');
		expect(options.headers['Source']).toBe('ro.radcom.smartcity.web');
		expect(options.headers['OS-Type']).toBeUndefined();
	});

	it('throws ApiError on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 500 })
		);

		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow(ApiError);
		await expect(apiFetchBinary('https://info.stb.ro/test')).rejects.toThrow('HTTP 500');
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

describe('ApiError', () => {
	it('has name and status properties', () => {
		const err = new ApiError('test error', 404);
		expect(err.name).toBe('ApiError');
		expect(err.message).toBe('test error');
		expect(err.status).toBe(404);
		expect(err).toBeInstanceOf(Error);
	});
});
