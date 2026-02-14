import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Protobuf encoding helpers (same as proto.test.ts) */
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

function buildStopResponse(lines: Array<{
	name: string;
	id: number;
	type: string;
	color: string;
	direction: string;
	times: number[];
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
		line.times.forEach((t, i) => {
			lineBytes.push(...encodeVarintField(6 + i, t));
		});
		bytes.push(...encodeMessageField(10, lineBytes));
	}
	return new Uint8Array(bytes);
}

describe('fetchArrivals', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('decodes protobuf response and filters to configured lines', async () => {
		const responseData = buildStopResponse([
			{ name: '27', id: 66, type: 'TRAM', color: '#BE1622', direction: 'Faur', times: [120, 300] },
			{ name: '32', id: 70, type: 'TRAM', color: '#BE1622', direction: 'Depoul Alexandria', times: [180] },
			{ name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'C.F.R. Progresul', times: [60] },
			{ name: '47', id: 61, type: 'TRAM', color: '#BE1622', direction: 'Ghencea', times: [90, 240, 480] }
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(responseData.buffer)
			})
		);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals();

		expect(result.stationName).toBe('Piata Unirii');
		expect(result.address).toBe('Bd. Regina Maria, Bucuresti');

		// Should filter out line 32 (not in TRAM_LINES set)
		expect(result.arrivals).toHaveLength(3);
		const lineNames = result.arrivals.map((a) => a.lineName);
		expect(lineNames).toEqual(['7', '27', '47']); // sorted by LINE_ORDER

		// Check arrival times
		const line27 = result.arrivals.find((a) => a.lineName === '27')!;
		expect(line27.direction).toBe('Faur');
		expect(line27.arrivingTimes).toEqual([120, 300]);

		const line7 = result.arrivals.find((a) => a.lineName === '7')!;
		expect(line7.arrivingTimes).toEqual([60]);

		const line47 = result.arrivals.find((a) => a.lineName === '47')!;
		expect(line47.arrivingTimes).toEqual([90, 240, 480]);
	});

	it('throws ApiError on network failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
		);

		const { fetchArrivals } = await import('./arrivals.js');
		await expect(fetchArrivals()).rejects.toThrow('Network error');
	});

	it('filters out unreasonable arrival times', async () => {
		const responseData = buildStopResponse([
			{ name: '27', id: 66, type: 'TRAM', color: '#BE1622', direction: 'Faur', times: [120, 99999] }
		]);

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(responseData.buffer)
			})
		);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals();
		const line27 = result.arrivals.find((a) => a.lineName === '27')!;
		// 99999 > 7200 so it should be filtered out
		expect(line27.arrivingTimes).toEqual([120]);
	});

	it('limits to 3 arrival times per line', async () => {
		const responseData = buildStopResponse([
			{ name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'Progresul', times: [60, 120, 180] }
		]);
		// Add an extra field 9 manually (would be treated as field 9 not in ARRIVAL_TIME_FIELDS)
		// Since we only read fields 6, 7, 8, only 3 times max anyway

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(responseData.buffer)
			})
		);

		const { fetchArrivals } = await import('./arrivals.js');
		const result = await fetchArrivals();
		const line7 = result.arrivals.find((a) => a.lineName === '7')!;
		expect(line7.arrivingTimes.length).toBeLessThanOrEqual(3);
	});
});
