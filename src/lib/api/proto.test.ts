import { describe, it, expect } from 'vitest';
import { ProtoReader, ProtoParseError } from './proto.js';

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
});
