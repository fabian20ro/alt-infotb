import { describe, it, expect } from 'vitest';
import { ProtoReader, ProtoParseError, getVarint, getMessages, getString, getVarints } from './proto.js';

describe('ProtoReader', () => {
	it('handles varint (type 0)', () => {
		const data = new Uint8Array([0x08, 0x01]); // field 1, value 1
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(1);
		expect(field?.wireType).toBe(0);
		expect(field?.value).toBe(1);
		expect(reader.done).toBe(true);
	});

	it('handles length-delimited (type 2)', () => {
		const data = new Uint8Array([0x12, 0x03, 0x61, 0x62, 0x63]); // field 2, length 3, "abc"
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(2);
		expect(field?.wireType).toBe(2);
		expect(field?.value).toEqual(new Uint8Array([0x61, 0x62, 0x63]));
		expect(reader.done).toBe(true);
	});

	it('throws ProtoParseError on truncated payload', () => {
		const data = new Uint8Array([0x12, 0x05, 0x61, 0x62]); // field 2, length 5, only 2 bytes provided
		const reader = new ProtoReader(data);
		expect(() => reader.readField()).toThrow(ProtoParseError);
	});

	it('handles 64-bit fixed (type 1)', () => {
		const data = new Uint8Array([0x09, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(1);
		expect(field?.wireType).toBe(1);
		expect(field?.value).toBe(1); // index of payload start
		expect(reader.done).toBe(false);
	});

	it('handles 30-bit fixed (type 5)', () => {
		const data = new Uint8Array([0x2d, 0x01, 0x02, 0x03, 0x04]); // field 5, type 5, 4 bytes
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(5);
		expect(field?.wireType).toBe(5);
		expect(field?.value).toBe(1);
		expect(reader.done).toBe(true);
	});

	it('throws error on unknown wire type', () => {
		const data = new Uint8Array([0x3b, 0x01]); // tag = 0x3b -> field 7, type 3.
		const reader = new ProtoReader(data);
		expect(() => reader.readField()).toThrow(ProtoParseError);
	});

	it('readAllFields parses multiple fields correctly', () => {
		const data = new Uint8Array([
			0x08, 0x01, // field 1, type 0, value 1
			0x12, 0x03, 0x61, 0x62, 0x63, // field 2, type 2, value "abc"
			0x08, 0x02, // field 1, type 0, value 2
		]);
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.get(1)).toEqual([1, 2]);
		expect(fields.get(2)).toEqual([new Uint8Array([0x61, 0x62, 0x63])]);
	});

	it('getVarint returns value or undefined', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		expect(getVarint(fields, 1)).toBeUndefined();
		fields.set(1, [1]);
		expect(getVarint(fields, 1)).toBe(1);
		fields.set(1, [new Uint8Array([1])]);
		expect(getVarint(fields, 1)).toBeUndefined();
	});

	it('getString returns string or undefined', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		expect(getString(fields, 1)).toBeUndefined();
		fields.set(1, [new Uint8Array([0x61, 0x62, 0x63])]);
		expect(getString(fields, 1)).toBe('abc');
		fields.set(1, [1]);
		expect(getString(fields, 1)).toBeUndefined();
	});

	it('getVarints returns all varint values for a field', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [1, 2, 3]);
		expect(getVarints(fields, 1)).toEqual([1, 2, 3]);
		expect(getVarints(fields, 2)).toEqual([]);
	});

	it('getMessages returns array of Uint8Array for repeated messages', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [new Uint8Array([0x01]), new Uint8Array([0x02])]);
		expect(getMessages(fields, 1)).toEqual([new Uint8Array([0x01]), new Uint8Array([0x02])]);
	});

	it('getMessages filters out non-Uint8Array values', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [1, new Uint8Array([1, 2]), 2]);
		expect(getMessages(fields, 1)).toEqual([new Uint8Array([1, 2])]);
	});
});