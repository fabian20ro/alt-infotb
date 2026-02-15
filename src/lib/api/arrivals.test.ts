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
}>): Uint8Array {
	const bytes: number[] = [
		...encodeStringField(1, 'Piata Unirii'),
		...encodeStringField(2, 'Bd. Regina Maria, Bucuresti'),
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

	it('filters out unreasonable arrival times (> 7200 seconds)', async () => {
		const responseData = buildStopResponse([
			{
				name: '27', id: 66, type: 'TRAM', color: '#BE1622', direction: 'Faur',
				arrivals: [{ seconds: 120 }, { seconds: 99999 }]
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
		const line27 = result.arrivals.find((a) => a.lineName === '27')!;
		expect(line27.arrivingTimes).toEqual([120]);
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
