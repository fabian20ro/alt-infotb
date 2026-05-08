import { describe, it, expect } from 'vitest';
import {
	ProtoReader,
	decodeString,
	getString,
	getVarint,
	getMessages,
	getVarints
} from './proto.js';

/** Helper: encode a varint into bytes */
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

/** Helper: encode a protobuf tag */
function encodeTag(fieldNumber: number, wireType: number): number[] {
	return encodeVarint((fieldNumber << 3) | wireType);
}

/** Helper: encode a string field */
function encodeStringField(fieldNumber: number, value: string): number[] {
	const encoded = new TextEncoder().encode(value);
	return [...encodeTag(fieldNumber, 2), ...encodeVarint(encoded.length), ...encoded];
}

/** Helper: encode a varint field */
function encodeVarintField(fieldNumber: number, value: number): number[] {
	return [...encodeTag(fieldNumber, 0), ...encodeVarint(value)];
}

/** Helper: encode a sub-message field */
function encodeMessageField(fieldNumber: number, content: number[]): number[] {
	return [...encodeTag(fieldNumber, 2), ...encodeVarint(content.length), ...content];
}

/** Build a fake STB stop response matching the real protobuf schema */
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
		// arrival times go in fields 6, 7, 8
		line.times.forEach((t, i) => {
			lineBytes.push(...encodeVarintField(6 + i, t));
		});

		bytes.push(...encodeMessageField(10, lineBytes));
	}

	return new Uint8Array(bytes);
}

describe('ProtoReader', () => {
	it('reads varint fields', () => {
		const data = new Uint8Array(encodeVarintField(2, 66));
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field).toEqual({ fieldNumber: 2, wireType: 0, value: 66 });
		expect(reader.done).toBe(true);
	});

	it('reads string fields', () => {
		const data = new Uint8Array(encodeStringField(1, 'hello'));
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field).not.toBeNull();
		expect(field!.fieldNumber).toBe(1);
		expect(field!.wireType).toBe(2);
		expect(decodeString(field!.value as Uint8Array)).toBe('hello');
	});

	it('reads multi-byte varints', () => {
		// 300 = 0b100101100 → varint bytes: 0xAC 0x02
		const data = new Uint8Array(encodeVarintField(1, 300));
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field).toEqual({ fieldNumber: 1, wireType: 0, value: 300 });
	});

	it('reads multiple fields', () => {
		const bytes = [
			...encodeStringField(1, 'test'),
			...encodeVarintField(2, 42),
			...encodeStringField(3, 'TRAM')
		];
		const reader = new ProtoReader(new Uint8Array(bytes));
		const fields = reader.readAllFields();

		expect(fields.size).toBe(3);
		expect(decodeString(fields.get(1)![0] as Uint8Array)).toBe('test');
		expect(fields.get(2)![0]).toBe(42);
		expect(decodeString(fields.get(3)![0] as Uint8Array)).toBe('TRAM');
	});

	it('handles repeated fields', () => {
		const bytes = [
			...encodeVarintField(6, 120),
			...encodeVarintField(7, 300),
			...encodeVarintField(6, 600) // repeated field 6
		];
		const reader = new ProtoReader(new Uint8Array(bytes));
		const fields = reader.readAllFields();

		expect(fields.get(6)).toEqual([120, 600]);
		expect(fields.get(7)).toEqual([300]);
	});


	it('throws on truncated length-delimited field', () => {
		const bytes = new Uint8Array([0x0a, 0x05, 0x41, 0x42]);
		const reader = new ProtoReader(bytes);
		expect(() => reader.readAllFields()).toThrow('truncated payload');
	});

	it('throws on varint too long', () => {
    		const bytes = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
    		const reader = new ProtoReader(bytes);
    		expect(() => reader.readField()).toThrow('Varint too long');
    	});

	it('skips 64-bit fixed fields', () => {
		// Tag for field 1, wire type 1 (64-bit)
		const bytes = new Uint8Array([
			0x09, // field 1, wire type 1
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 8 bytes of data
			...encodeVarintField(2, 99)
		]);
		const reader = new ProtoReader(bytes);
		const fields = reader.readAllFields();
		expect(fields.get(2)).toEqual([99]);
	});

	it('skips 32-bit fixed fields', () => {
		// Tag for field 1, wire type 5 (32-bit)
		const bytes = new Uint8Array([
			0x0d, // field 1, wire type 5
			0x00, 0x00, 0x00, 0x00, // 4 bytes of data
			...encodeVarintField(2, 77)
		]);
		const reader = new ProtoReader(bytes);
		const fields = reader.readAllFields();
		expect(fields.get(2)).toEqual([77]);
	});
});

describe('helper functions', () => {
	it('getString returns string for field', () => {
		const bytes = [...encodeStringField(1, 'Piata Unirii'), ...encodeVarintField(2, 42)];
		const reader = new ProtoReader(new Uint8Array(bytes));
		const fields = reader.readAllFields();

		expect(getString(fields, 1)).toBe('Piata Unirii');
		expect(getString(fields, 2)).toBeUndefined(); // varint, not string
		expect(getString(fields, 99)).toBeUndefined(); // missing
	});

	it('getVarint returns number for field', () => {
		const bytes = [...encodeStringField(1, 'test'), ...encodeVarintField(2, 66)];
		const reader = new ProtoReader(new Uint8Array(bytes));
		const fields = reader.readAllFields();

		expect(getVarint(fields, 2)).toBe(66);
		expect(getVarint(fields, 1)).toBeUndefined(); // string, not varint
		expect(getVarint(fields, 99)).toBeUndefined(); // missing
	});

	it('getMessages returns embedded messages', () => {
		const sub1 = encodeStringField(1, 'a');
		const sub2 = encodeStringField(1, 'b');
		const bytes = [...encodeMessageField(10, sub1), ...encodeMessageField(10, sub2)];
		const reader = new ProtoReader(new Uint8Array(bytes));
		const fields = reader.readAllFields();

		const msgs = getMessages(fields, 10);
		expect(msgs).toHaveLength(2);
		expect(decodeString(msgs[0])).toContain('a');
		expect(decodeString(msgs[1])).toContain('b');
	});

	it('getVarints returns all varint values for a field', () => {
		const bytes = [
			...encodeVarintField(6, 120),
			...encodeVarintField(7, 300),
			...encodeVarintField(8, 600)
		];
		const reader = new ProtoReader(new Uint8Array(bytes));
		const fields = reader.readAllFields();

		expect(getVarints(fields, 6)).toEqual([120]);
		expect(getVarints(fields, 7)).toEqual([300]);
	});
});

describe('full stop response decode', () => {
	it('decodes a complete stop response', () => {
		const data = buildStopResponse([
			{ name: '27', id: 66, type: 'TRAM', color: '#BE1622', direction: 'Faur', times: [120, 300] },
			{ name: '32', id: 70, type: 'TRAM', color: '#BE1622', direction: 'Depoul Alexandria', times: [180] },
			{ name: '7', id: 69, type: 'TRAM', color: '#BE1622', direction: 'C.F.R. Progresul', times: [60, 240, 480] },
			{ name: '47', id: 61, type: 'TRAM', color: '#BE1622', direction: 'Ghencea', times: [90] }
		]);

		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();

		expect(getString(fields, 1)).toBe('Piata Unirii');
		expect(getString(fields, 2)).toBe('Bd. Regina Maria, Bucuresti');
		expect(getString(fields, 5)).toBe('STATION');

		const lineMessages = getMessages(fields, 10);
		expect(lineMessages).toHaveLength(4);

		// Decode line 27
		const line27 = new ProtoReader(lineMessages[0]).readAllFields();
		expect(getString(line27, 1)).toBe('27');
		expect(getVarint(line27, 2)).toBe(66);
		expect(getString(line27, 3)).toBe('TRAM');
		expect(getString(line27, 4)).toBe('#BE1622');
		expect(getString(line27, 5)).toBe('Faur');
		expect(getVarints(line27, 6)).toEqual([120]);
		expect(getVarints(line27, 7)).toEqual([300]);

		// Decode line 7 (third entry)
		const line7 = new ProtoReader(lineMessages[2]).readAllFields();
		expect(getString(line7, 1)).toBe('7');
		expect(getVarints(line7, 6)).toEqual([60]);
		expect(getVarints(line7, 7)).toEqual([240]);
		expect(getVarints(line7, 8)).toEqual([480]);
	});
});
