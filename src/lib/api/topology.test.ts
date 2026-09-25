import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeLineRegistry, decodeLineTopology, decodeStopMemberships } from './topology.ts';
import { ProtoParseError } from './proto.ts';

// Registry/topology messages below are synthetic, encoded from the public STB schema.
// The stop-response fixtures are unmodified live responses; see fixtures/topology/README.md.
function varint(value: number): number[] {
	const bytes: number[] = [];
	do {
		const low = value % 128;
		value = Math.floor(value / 128);
		bytes.push(low | (value ? 128 : 0));
	} while (value);
	return bytes;
}
const integer = (field: number, value: number) => [(field << 3), ...varint(value)];
const message = (field: number, bytes: number[]) => [(field << 3) | 2, ...varint(bytes.length), ...bytes];
const string = (field: number, value: string) => message(field, [...new TextEncoder().encode(value)]);
function double(field: number, value: number): number[] {
	const bytes = new Uint8Array(8);
	new DataView(bytes.buffer).setFloat64(0, value, true);
	return [(field << 3) | 1, ...bytes];
}
const identity = (type = 'CABLE_CAR', id = 66) => [
	...integer(1, id), ...string(2, '66'), ...string(3, type)
];
const stop = (id = 6084, lat = 44.43, lon = 26.2) => [
	...integer(1, id), ...double(2, lat), ...double(3, lon), ...string(4, 'Isovolta')
];
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

describe('decodeLineRegistry', () => {
	it('normalizes raw types, preserves line IDs, and tolerates unknown additive fields', () => {
		const result = decodeLineRegistry(bytes(
			message(1, [...identity(), ...string(15, 'future')]),
			message(1, identity('BUS', 199)), integer(14, 1)
		));
		expect(result).toEqual([
			{ id: 66, name: '66', type: 'TROLLEYBUS', rawType: 'CABLE_CAR' },
			{ id: 199, name: '66', type: 'BUS', rawType: 'BUS' }
		]);
	});
	it('retains an unknown enum so collection can report its exact value', () => {
		expect(decodeLineRegistry(bytes(message(1, identity('FERRY'))))[0])
			.toMatchObject({ rawType: 'FERRY', type: undefined });
	});
	it('rejects duplicate registry IDs', () => {
		expect(() => decodeLineRegistry(bytes(message(1, identity()), message(1, identity()))))
			.toThrow('Duplicate registry line ID');
	});
	it.each([
		['empty', []], ['wrong registry wire', integer(1, 5)],
		['missing identity', message(1, string(2, '66'))],
		['zero ID', message(1, identity('BUS', 0))],
		['wrong ID wire', message(1, [...double(1, 66), ...string(2, '66'), ...string(3, 'BUS')])],
		['blank name', message(1, [...integer(1, 66), ...string(2, ' '), ...string(3, 'BUS')])],
		['duplicate ID field', message(1, [...identity(), ...integer(1, 1)])],
		['invalid UTF-8', message(1, [...integer(1, 66), ...message(2, [0xff]), ...string(3, 'BUS')])],
		['truncated message', [10, 20, 8]]
	] as const)('rejects %s', (_label, payload) => {
		expect(() => decodeLineRegistry(new Uint8Array(payload))).toThrow(ProtoParseError);
	});
});

describe('decodeLineTopology', () => {
	it('decodes ordered stops and both direction names without clipping regional coordinates', () => {
		const result = decodeLineTopology(bytes(identity(), string(10, 'A'), string(11, 'B'),
			message(12, stop()), message(12, stop(9001, 44.8, 26.5))));
		expect(result.directionNames).toEqual({ 0: 'A', 1: 'B' });
		expect(result.stops).toEqual([
			{ id: 6084, name: 'Isovolta', lat: 44.43, lon: 26.2 },
			{ id: 9001, name: 'Isovolta', lat: 44.8, lon: 26.5 }
		]);
	});
	it('preserves repeated stops for loop routes', () => {
		expect(decodeLineTopology(bytes(identity(), message(12, stop()), message(12, stop()))).stops)
			.toHaveLength(2);
	});
	it('reads fixed64 coordinates from a Uint8Array with a nonzero byte offset', () => {
		const payload = bytes(identity(), message(12, stop()));
		const storage = new Uint8Array(payload.length + 16);
		storage.set(payload, 8);
		expect(decodeLineTopology(storage.subarray(8, -8)).stops[0].lat).toBe(44.43);
	});
	it.each([
		['empty', []], ['missing stops', identity()],
		['invalid latitude', [...identity(), ...message(12, stop(6084, 91))]],
		['invalid longitude', [...identity(), ...message(12, stop(6084, 44, -181))]],
		['nonfinite latitude', [...identity(), ...message(12, stop(6084, NaN))]],
		['missing longitude', [...identity(), ...message(12, [...integer(1, 6084), ...double(2, 44), ...string(4, 'A')])]],
		['wrong latitude wire', [...identity(), ...message(12, [...integer(1, 6084), ...integer(2, 44), ...double(3, 26), ...string(4, 'A')])]],
		['wrong stops wire', [...identity(), ...integer(12, 6084)]]
	])('rejects %s', (_label, payload) => {
		expect(() => decodeLineTopology(new Uint8Array(payload as number[]))).toThrow(ProtoParseError);
	});
});

describe('decodeStopMemberships', () => {
	it('decodes real Isovolta evidence, including both lines missing from its old GTFS membership', () => {
		const fixture = readFileSync(new URL('./fixtures/topology/isovolta-6084.pb', import.meta.url));
		const result = decodeStopMemberships(fixture, 6084);
		expect(result.id).toBe(6084);
		expect(result.name).toBe('Isovolta');
		expect(result.lines).toEqual([
			{ id: 148, name: '103', type: 'BUS', rawType: 'BUS', directionId: 1 },
			{ id: 189, name: '246', type: 'BUS', rawType: 'BUS', directionId: 0 },
			{ id: 199, name: 'N109', type: 'BUS', rawType: 'BUS', directionId: 1 },
			{ id: 889, name: '640', type: 'BUS', rawType: 'BUS', directionId: 0 }
		]);
	});
	it('decodes the real CABLE_CAR enum for line 66 at Bucur Obor', () => {
		const fixture = readFileSync(new URL('./fixtures/topology/bucur-obor-3684.pb', import.meta.url));
		expect(decodeStopMemberships(fixture, 3684).lines.find((line) => line.name === '66'))
			.toMatchObject({ type: 'TROLLEYBUS', rawType: 'CABLE_CAR' });
	});
	it('preserves real arrival IDs even when the registry uses other IDs for the same names', () => {
		const fixture = readFileSync(new URL('./fixtures/topology/chitila-6207.pb', import.meta.url));
		const lines = decodeStopMemberships(fixture, 6207).lines;
		expect(lines.filter((line) => ['429', '476'].includes(line.name))).toEqual([
			expect.objectContaining({ id: 796, name: '429', type: 'BUS', directionId: 0 }),
			expect.objectContaining({ id: 907, name: '429', type: 'BUS', directionId: 1 }),
			expect.objectContaining({ id: 798, name: '476', type: 'BUS', directionId: 0 }),
			expect.objectContaining({ id: 909, name: '476', type: 'BUS', directionId: 1 })
		]);
	});
	it('preserves the observed N700 line absent from the contemporaneous registry', () => {
		const fixture = readFileSync(new URL('./fixtures/topology/unirii-7428.pb', import.meta.url));
		expect(decodeStopMemberships(fixture, 7428).lines.find((line) => line.name === 'N700'))
			.toMatchObject({ id: 1036, type: 'BUS', directionId: 0 });
	});
	it('preserves named zero-line responses for inconclusive audit classification', () => {
		expect(decodeStopMemberships(bytes(string(1, 'Empty stop')), 1))
			.toEqual({ id: 1, name: 'Empty stop', lines: [] });
	});
	it('does not require arrivals for positive membership evidence', () => {
		const entry = [...string(1, 'N109'), ...integer(2, 199), ...string(3, 'BUS'), ...integer(8, 0)];
		expect(decodeStopMemberships(bytes(string(1, 'Isovolta'), message(10, entry)), 6084).lines)
			.toHaveLength(1);
	});
	it.each([[], integer(1, 1), string(1, '')])('rejects unnamed or empty response %j', (payload) => {
		expect(() => decodeStopMemberships(new Uint8Array(payload), 6084)).toThrow(ProtoParseError);
	});
	it.each([undefined, 2])('rejects unverified direction %s', (direction) => {
		const entry = [...string(1, 'N109'), ...integer(2, 199), ...string(3, 'BUS'),
			...(direction === undefined ? [] : integer(8, direction))];
		expect(() => decodeStopMemberships(bytes(string(1, 'Isovolta'), message(10, entry)), 6084))
			.toThrow('direction');
	});
	it.each([0, -1, 1.5, NaN])('rejects invalid source ID %s', (id) => {
		expect(() => decodeStopMemberships(bytes(string(1, 'Isovolta')), id)).toThrow('source stop ID');
	});
});
