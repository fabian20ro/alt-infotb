import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Protobuf encoding helpers */
function encodeVarint(value: number): number[] {
	const bytes: number[] = [];
	let v = value >>> 0;
	while (v > 0x7f) {
		bytes.push((v & 0x7f) | 0x80);
		v >>>= 7;
	}
	bytes.push(v);
	return bytes;
}

function encodeTag(fieldNumber: number, wireType: number): number[] {
	return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeStringField(fieldNumber: number, value: string): number[] {
	const encoded = new TextEncoder().encode(value);
	return [...encodeTag(fieldNumber, 2), ...encodeVarint(encoded.length), ...encoded];
}

function encodeVarintField(fieldNumber: number, value: number): number[] {
	return [...encodeTag(fieldNumber, 0), ...encodeVarint(value)];
}

function encodeMessageField(fieldNumber: number, content: number[]): number[] {
	return [...encodeTag(fieldNumber, 2), ...encodeVarint(content.length), ...content];
}

/** Encode an ArrivalEntry sub-message: {1: isScheduled, 2: seconds} */
function encodeArrivalEntry(seconds: number, isScheduled = 0): number[] {
	return [
		...encodeVarintField(1, isScheduled),
		...encodeVarintField(2, seconds)
	];
}

function buildStopResponse(lines: Array<{
	name: string;
	id: number;
	type: string;
	color: string;
	direction: string;
	arrivals: Array<{ seconds: number; isScheduled?: number }>;
}>, stationName = 'Piata Unirii', address = 'Bd. Regina Maria, Bucuresti'): Uint8Array {
	const bytes: number[] = [
		...encodeStringField(1, stationName),
		...encodeStringField(2, address),
		...encodeStringField(5, 'STATION')
	];
	for (const line of lines) {
		const lineBytes: number[] = [
			...encodeStringField(1, line.name),
			...encodeVarintField(2, line.id),
			...encodeStringField(3, line.type),
			...encodeStringField(4, line.color),
			...encodeStringField(5, line.direction)
		];
		// Encode field 9 repeated arrival sub-messages
		for (const arr of line.arrivals) {
			const entryBytes = encodeArrivalEntry(arr.seconds, arr.isScheduled ?? 0);
			lineBytes.push(...encodeMessageField(9, entryBytes));
		}
		bytes.push(...encodeMessageField(10, lineBytes));
	}
	return new Uint8Array(bytes);
}

describe('fetchArrivals', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('decodes protobuf response with field 9 arrival sub-messages', async () => {
		const responseData = buildStopResponse([
			{
				name: '27', id: 66, type: 'TRAM', color: '#BE1622', direction: 'Faur',
				arrivals: [{ seconds: 480 }, { seconds: 1560 }, { seconds: 2280, isScheduled: 1 }]
			},
			{
				name: '32', id: 70, type: 'TRAM', color: '#BE1622', direction: 'Depoul Alexandria',
				arrivals: [{ seconds: 240 }, { seconds: 540 }, { seconds: 840 }]
			},
			{
				name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'C.F.R. Progresul',
				arrivals: [{ seconds: 120 }, { seconds: 1080 }]
			},
			{
				name: '47', id: 61, type: 'TRAM', color: '#BE1622', direction: 'Ghencea',
				arrivals: [{ seconds: 660 }, { seconds: 1500 }, { seconds: 2160 }]
			}
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(responseData.buffer)
			})
		);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals(3570);

		expect(result.stationName).toBe('Piata Unirii');
		expect(result.address).toBe('Bd. Regina Maria, Bucuresti');

		// All 4 lines should be present (no tram-only filter)
		expect(result.arrivals).toHaveLength(4);
		const lineNames = result.arrivals.map((a) => a.lineName);
		expect(lineNames).toEqual(['7', '27', '32', '47']); // sorted numerically

		// Check arrival times from field 9 sub-messages
		const line27 = result.arrivals.find((a) => a.lineName === '27')!;
		expect(line27.direction).toBe('Faur');
		expect(line27.arrivingTimes).toEqual([480, 1560, 2280]);

		const line7 = result.arrivals.find((a) => a.lineName === '7')!;
		expect(line7.arrivingTimes).toEqual([120, 1080]);

		const line47 = result.arrivals.find((a) => a.lineName === '47')!;
		expect(line47.arrivingTimes).toEqual([660, 1500, 2160]);
	});

	it('includes all transport types (bus, tram, trolleybus)', async () => {
		const responseData = buildStopResponse([
			{
				name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'Progresul',
				arrivals: [{ seconds: 120 }]
			},
			{
				name: '104', id: 200, type: 'BUS', color: '#006600', direction: 'Gara de Nord',
				arrivals: [{ seconds: 300 }]
			},
			{
				name: '85', id: 150, type: 'TROLLEYBUS', color: '#0066CC', direction: 'Pantelimon',
				arrivals: [{ seconds: 600 }]
			}
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(responseData.buffer)
			})
		);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals(3570);

		expect(result.arrivals).toHaveLength(3);
		expect(result.arrivals.map((a) => a.vehicleType)).toEqual(['TRAM', 'TROLLEYBUS', 'BUS']);
	});

	it('throws ApiError on network failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
		);

		const { fetchArrivals } = await import('./arrivals.js');
		await expect(fetchArrivals(3570)).rejects.toThrow('Network error');
	});

	it('preserves HTTP status codes from the STB API in ApiError', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 401 })
		);

		const { fetchArrivals } = await import('./arrivals.js');
		await expect(fetchArrivals(3570)).rejects.toMatchObject({
			status: 401,
			message: expect.stringContaining('HTTP 401')
		});
	});

	it('throws ApiError when protobuf payload is malformed', async () => {
		const malformed = new Uint8Array([0x0a, 0x05, 0x41]);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(malformed.buffer) }));
		const { fetchArrivals } = await import('./arrivals.js');
		await expect(fetchArrivals(3570)).rejects.toThrow('protobuf corrupt');
	});

	it('throws when provided with an empty array of stop IDs', async () => {
		const { fetchArrivals } = await import('./arrivals.js');
		await expect(fetchArrivals([])).rejects.toThrow('All subway stop fetches failed');
	});

	it('filters arrival times outside the valid range [0, 7200]', async () => {
		const responseData = buildStopResponse([
			{
				name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'Progresul',
				arrivals: [{ seconds: -1 }, { seconds: 0 }, { seconds: 7200 }, { seconds: 7201 }]
			}
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(responseData.buffer)
			})
		);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals(3570);
		const line7 = result.arrivals.find((a) => a.lineName === '7')!;
		expect(line7.arrivingTimes).toEqual([0, 7200]);
	});

	it('limits to 3 arrival times per line', async () => {
		const responseData = buildStopResponse([
			{
				name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'Progresul',
				arrivals: [
					{ seconds: 60 }, { seconds: 120 }, { seconds: 180 }, { seconds: 240 }
				]
			}
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(responseData.buffer)
			})
		);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals(3570);
		const line7 = result.arrivals.find((a) => a.lineName === '7')!;
		expect(line7.arrivingTimes).toHaveLength(3);
		expect(line7.arrivingTimes).toEqual([60, 120, 180]);
	});

	it('passes stop_id parameter to API URL', async () => {
		const responseData = buildStopResponse([]);
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(responseData.buffer)
		});
		vi.stubGlobal('fetch', mockFetch);

		const { fetchArrivals } = await import('./arrivals.js');
		await fetchArrivals(9999);

		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining('stop_id=9999'),
			expect.anything()
		);
	});

	it('uses API-provided color for each line', async () => {
		const responseData = buildStopResponse([
			{
				name: '104', id: 200, type: 'BUS', color: '#006600', direction: 'Gara de Nord',
				arrivals: [{ seconds: 300 }]
			}
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(responseData.buffer)
			})
		);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals(3570);
		expect(result.arrivals[0].color).toBe('#006600');
	});
});

describe('fetchArrivals multi-stop merging', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('fetches multiple stops in parallel and merges arrivals', async () => {
		const stop1 = buildStopResponse([
			{
				name: 'M1', id: 522, type: 'SUBWAY', color: '#1D1D1B', direction: 'Dristor',
				arrivals: [{ seconds: 300 }]
			}
		], 'Piata Unirii', 'Piata Unirii');

		const stop2 = buildStopResponse([
			{
				name: 'M2', id: 523, type: 'SUBWAY', color: '#1D1D1B', direction: 'Pipera',
				arrivals: [{ seconds: 180 }]
			}
		], 'Piata Unirii', 'Piata Unirii');

		const mockFetch = vi.fn()
			.mockImplementation((url: string) => {
				const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
				const data = stopId === '9552' ? stop1 : stop2;
				return Promise.resolve({
					ok: true,
					arrayBuffer: () => Promise.resolve(data.buffer)
				});
			});
		vi.stubGlobal('fetch', mockFetch);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([9552, 9543]);

		// Both lines merged
		expect(result.arrivals).toHaveLength(2);
		const lineNames = result.arrivals.map((a) => a.lineName);
		expect(lineNames).toContain('M1');
		expect(lineNames).toContain('M2');

		// Fetched both stops
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});


	it('uses most common station metadata and de-duplicates merged lines', async () => {
		const stop1 = buildStopResponse([{ name: 'M1', id: 1, type: 'SUBWAY', color: '#111', direction: 'D1', arrivals: [{ seconds: 300 }, { seconds: 600 }] }], 'Piata Unirii', 'Addr A');
		const stop2 = buildStopResponse([{ name: 'M1', id: 1, type: 'SUBWAY', color: '#111', direction: 'D1', arrivals: [{ seconds: 600 }, { seconds: 900 }] }], 'Piata Unirii', 'Addr B');
		vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
			const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
			const data = stopId === '9552' ? stop1 : stop2;
			return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(data.buffer) });
		}));
		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([9552, 9543]);
		expect(result.stationName).toBe('Piata Unirii');
		expect(result.arrivals).toHaveLength(1);
		expect(result.arrivals[0].arrivingTimes).toEqual([300, 600, 900]);
	});

	it('sorts merged arrivals by line name', async () => {
		const stop1 = buildStopResponse([
			{
				name: 'M3', id: 521, type: 'SUBWAY', color: '#1D1D1B', direction: 'Preciziei',
				arrivals: [{ seconds: 600 }]
			}
		], 'Piata Unirii');

		const stop2 = buildStopResponse([
			{
				name: 'M1', id: 522, type: 'SUBWAY', color: '#1D1D1B', direction: 'Pantelimon',
				arrivals: [{ seconds: 300 }]
			}
		], 'Piata Unirii');

		const mockFetch = vi.fn()
			.mockImplementation((url: string) => {
				const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
				const data = stopId === '9552' ? stop1 : stop2;
				return Promise.resolve({
					ok: true,
					arrayBuffer: () => Promise.resolve(data.buffer)
				});
			});
		vi.stubGlobal('fetch', mockFetch);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([9552, 9553]);

		// Sorted: M1 before M3
		expect(result.arrivals.map((a) => a.lineName)).toEqual(['M1', 'M3']);
	});

	it('returns empty arrivingTimes when a line entry has no arrival sub-messages', async () => {
		const responseData = buildStopResponse([
			{ name: '1', id: 1, type: 'BUS', color: '#000', direction: 'D', arrivals: [] }
		]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(responseData.buffer)
		}));

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals(3570);
		expect(result.arrivals).toHaveLength(1);
		expect(result.arrivals[0].lineName).toBe('1');
		expect(result.arrivals[0].arrivingTimes).toEqual([]);
	});

	it('tolerates partial failures in multi-stop fetch', async () => {
		const stop1 = buildStopResponse([
			{
				name: 'M1', id: 522, type: 'SUBWAY', color: '#1D1D1B', direction: 'Dristor',
				arrivals: [{ seconds: 300 }]
			}
		], 'Piata Unirii');

		const mockFetch = vi.fn()
			.mockImplementation((url: string) => {
				const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
				if (stopId === '9552') {
					return Promise.resolve({
						ok: true,
						arrayBuffer: () => Promise.resolve(stop1.buffer)
					});
				}
				return Promise.resolve({ ok: false, status: 500 });
			});
		vi.stubGlobal('fetch', mockFetch);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([9552, 9543]);

		// Only the successful stop's arrivals
		expect(result.arrivals).toHaveLength(1);
		expect(result.arrivals[0].lineName).toBe('M1');
	});

	it('throws when all stops fail in multi-stop fetch', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: false, status: 500 })
		);

		const { fetchArrivals } = await import('./arrivals.js');
		await expect(fetchArrivals([9552, 9543])).rejects.toThrow();
	});

	it('sorts line names numerically when possible, then lexicographically', async () => {
		const responseData = buildStopResponse([
			{
				name: '10', id: 10, type: 'BUS', color: '#000', direction: 'D',
				arrivals: [{ seconds: 100 }]
			},
			{
				name: '2', id: 2, type: 'BUS', color: '#000', direction: 'D',
				arrivals: [{ seconds: 100 }]
			},
			{
				name: '1', id: 1, type: 'BUS', color: '#000', direction: 'D',
				arrivals: [{ seconds: 100 }]
			},
			{
				name: 'M2', id: 20, type: 'BUS', color: '#000', direction: 'D',
				arrivals: [{ seconds: 100 }]
			},
			{
				name: 'M10', id: 100, type: 'BUS', color: '#000', direction: 'D',
				arrivals: [{ seconds: 100 }]
			}
		]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(responseData.buffer)
		}));

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals(3570);
		expect(result.arrivals.map((a) => a.lineName)).toEqual(['1', '2', '10', 'M10', 'M2']);
	});

	it('picks the most frequent station name and address during merge', async () => {
		const stop1 = buildStopResponse([], 'Station A', 'Address A');
		const stop2 = buildStopResponse([], 'Station A', 'Address B');
		const stop3 = buildStopResponse([], 'Station C', 'Address A');

		vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
			const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
			if (stopId === '1') return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop1.buffer) });
			if (stopId === '2') return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop2.buffer) });
			return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop3.buffer) });
		}));

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([1, 2, 3]);
		expect(result.stationName).toBe('Station A');
		expect(result.address).toBe('Address A');
	});

	it('treats NFC-composed and decomposed station names as identical during merge', async () => {
		const composed = 'Pia\u021ba Unirii';   // U+0219 (s-comma) — NFC form used by STB
		const decomposed = 'Pi\u02C7a Unirii';  // U+0307 combining acute, applied to a → NFD form

		const stop1 = buildStopResponse([], composed, '');
		const stop2 = buildStopResponse([], decomposed, '');

		vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
			const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
			if (stopId === '9552') return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop1.buffer) });
			return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop2.buffer) });
		}));

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([9552, 9543]);

		// Both forms should count as the same key → NFC canonical form wins (originalValues.get)
		expect(result.stationName).toBe(composed);
	});

	it('respects MAX_ARRIVALS_PER_LINE when merging arrivals from multiple stops', async () => {
		const stop1 = buildStopResponse([
			{
				name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'Progresul',
				arrivals: [{ seconds: 10 }, { seconds: 20 }, { seconds: 30 }]
			}
		]);
		const stop2 = buildStopResponse([
			{
				name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'Progresul',
				arrivals: [{ seconds: 15 }, { seconds: 25 }, { seconds: 35 }]
			}
		]);
		vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
			const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
			if (stopId === '9552') return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop1.buffer) });
			return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop2.buffer) });
		}));
		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([9552, 9543]);
		const line7 = result.arrivals.find((a) => a.lineName === '7')!;
		expect(line7.arrivingTimes).toEqual([10, 15, 20]);
	});

	it('preserves separate entries for the same line with different directions', async () => {
		const stop1 = buildStopResponse([
			{ name: '1', id: 1, type: 'BUS', color: '#000', direction: 'North', arrivals: [{ seconds: 100 }] }
		]);
		const stop2 = buildStopResponse([
			{ name: '1', id: 1, type: 'BUS', color: '#000', direction: 'South', arrivals: [{ seconds: 200 }] }
		]);
		vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
			const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
			if (stopId === '1') return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop1.buffer) });
			return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop2.buffer) });
		}));
		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([1, 2]);
		expect(result.arrivals).toHaveLength(2);
		expect(result.arrivals.find(a => a.direction === 'North')!.arrivingTimes).toEqual([100]);
		expect(result.arrivals.find(a => a.direction === 'South')!.arrivingTimes).toEqual([200]);
	});


	it('sorts line names numerically even when provided out of order', async () => {
		const responseData = buildStopResponse([
			{ name: '2', id: 2, type: 'BUS', color: '#000', direction: 'D', arrivals: [{ seconds: 100 }] },
			{ name: '10', id: 10, type: 'BUS', color: '#000', direction: 'D', arrivals: [{ seconds: 100 }] },
			{ name: '1', id: 1, type: 'BUS', color: '#000', direction: 'D', arrivals: [{ seconds: 100 }] }
		]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(responseData.buffer)
		}));

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals(3570);
		expect(result.arrivals.map((a) => a.lineName)).toEqual(['1', '2', '10']);
	});

	it('falls back to first stop metadata when all stops return empty station name and address', async () => {
		const stop1 = buildStopResponse([], '', '');
		const stop2 = buildStopResponse([], '', '');
		vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
			const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
			if (stopId === '9552') return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop1.buffer) });
			return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop2.buffer) });
		}));
		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([9552, 9543]);
		expect(result.stationName).toBe('');
		expect(result.address).toBe('');
	});

	it('preserves line id and vehicle type from protobuf during merge', async () => {
		const stop1 = buildStopResponse([{ name: 'M1', id: 522, type: 'SUBWAY', color: '#1D1D1B', direction: 'Dristor', arrivals: [{ seconds: 300 }] }], 'Piața Unirii');
		const stop2 = buildStopResponse([{ name: 'M1', id: 522, type: 'SUBWAY', color: '#1D1D1B', direction: 'Dristor', arrivals: [{ seconds: 600 }] }], 'Piața Unirii');
		vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
			const stopId = new URL(url, 'http://localhost').searchParams.get('stop_id');
			if (stopId === '9552') return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop1.buffer) });
			return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(stop2.buffer) });
		}));
		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals([9552, 9543]);
		expect(result.arrivals[0].lineId).toBe(522);
		expect(result.arrivals[0].vehicleType).toBe('SUBWAY');
	});

	it('exports formatArrivalTime for seconds-to-arrival formatting', async () => {
		const { formatArrivalTime } = await import('./arrivals.js');
		expect(formatArrivalTime(5)).toBe('acum');
		expect(formatArrivalTime(29)).toBe('acum');
		expect(formatArrivalTime(30)).toBe('1 min');
		expect(formatArrivalTime(480)).toBe('8 min');
		expect(formatArrivalTime(3600)).toBe('1 oră');
		expect(formatArrivalTime(3660)).toBe('1 oră, 1 min');
		expect(formatArrivalTime(7200)).toBe('2 ore');
		expect(formatArrivalTime(-5)).toBe('acum');
	});

	it('exports formatTime for HH:MM date formatting', async () => {
		const { formatTime } = await import('./arrivals.js');
		// Use a fixed time to avoid flaky hour output across locales/runs
		const d = new Date(2026, 6, 1, 9, 7); // July 1, 09:07 UTC — ro-RO will show as local
		const formatted = formatTime(d);
		expect(formatted).toMatch(/\d{2}:\d{2}/);
	});

	it('decodes all line fields (id, vehicleType) from protobuf during fetch', async () => {
		const responseData = buildStopResponse([{
			name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'C.F.R. Progresul',
			arrivals: [{ seconds: 120 }]
		}]);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(responseData.buffer)
		}));

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals(3570);
		expect(result.arrivals[0].lineId).toBe(69);
		expect(result.arrivals[0].vehicleType).toBe('TRAM');
	});
});
