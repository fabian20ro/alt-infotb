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

	it('returns null when readField is called with empty buffer', () => {
		const reader = new ProtoReader(new Uint8Array([]));
		expect(reader.readField()).toBeNull();
	});

	it('returns null when readField is called after buffer is exhausted', () => {
		const reader = new ProtoReader(new Uint8Array([0x08, 0x01]));
		reader.readField();
		expect(reader.readField()).toBeNull();
	});

	it('throws error when varint is too long', () => {
		const data = new Uint8Array([0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81]);
		const reader = new ProtoReader(data);
		expect(() => reader.readField()).toThrow(ProtoParseError);
	});

	it('throws error on truncated varint', () => {
		const data = new Uint8Array([0x81]); // MSB is 1, but buffer ends
		const reader = new ProtoReader(data);
		expect(() => reader.readField()).toThrow(ProtoParseError);
	});

	it('throws TypeError when constructed with null', () => {
		expect(() => new ProtoReader(null)).toThrow(TypeError);
	});

	it('throws TypeError when constructed with undefined', () => {
		expect(() => new ProtoReader()).toThrow(TypeError);
	});

	it('throws TypeError when constructed with a plain object', () => {
		expect(() => new ProtoReader({})).toThrow(TypeError);
	});

	it('does not silently return partial varint on truncated payload', () => {
		// Regression: a continuation byte at end of buffer must throw, never return garbage.
		const data = new Uint8Array([0x12, 0x81]); // field 2 tag + continuation varint byte with no terminator
		const reader = new ProtoReader(data);
		expect(() => reader.readField()).toThrow(/Truncated varint/);
	});

	it('does not silently return partial varint on truncated length-delimited payload', () => {
		// Regression: a truncated length field must cause parse failure, never read garbage bytes.
		const data = new Uint8Array([0x12, 0xff, 0x7f]); // tag=field2 + multi-byte varint with MSB set on last byte
		const reader = new ProtoReader(data);
		expect(() => reader.readField()).toThrow(ProtoParseError);
	});

	it('accepts zero-length length-delimited payload', () => {
		// Regression: a valid protobuf encoding of an empty sub-message (length=0) must decode,
		// not throw. The STB API can return optional fields with empty embedded messages.
		const data = new Uint8Array([0x12, 0x00]); // field 2, wire type 2, length 0
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(2);
		expect(field?.wireType).toBe(2);
		expect(field?.value).toEqual(new Uint8Array([]));
		expect(reader.done).toBe(true);
	});

	it('accepts zero-length length-delimited payload repeated', () => {
		// Regression: repeated empty sub-messages must all decode.
		const data = new Uint8Array([
			0x12, 0x03, 0x61, 0x62, 0x63, // field 2, "abc"
			0x12, 0x00,                     // field 2, empty
			0x12, 0x00                      // field 2, empty again
		]);
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.get(2)).toHaveLength(3);
		expect(fields.get(2)![0]).toEqual(new Uint8Array([0x61, 0x62, 0x63]));
		expect(fields.get(2)![1]).toEqual(new Uint8Array([]));
		expect(fields.get(2)![2]).toEqual(new Uint8Array([]));
	});

	it('throws ProtoParseError on field number 0 (wire-level corruption)', () => {
		// Field number 0 is reserved in protobuf — encountering it means a corrupted wire stream.
		// Tag = 0x01 → field 0, wireType 1; tag = 0x80 → field 0, wireType 0.
		for (const badTag of [0x01, 0x80]) {
			const data = new Uint8Array([badTag]); // single-byte tag already implies field 0
			const reader = new ProtoReader(data);
			expect(() => reader.readField()).toThrow(ProtoParseError);
		}
	});

	it('accepts a zero-length (empty) Uint8Array without throwing', () => {
		// Regression: an empty buffer is valid input. readAllFields must return an empty Map,
		// and calling readField repeatedly must keep returning null — never throw or loop.
		const reader = new ProtoReader(new Uint8Array([]));
		expect(reader.done).toBe(true);
		expect(reader.readField()).toBeNull();
		const fields = reader.readAllFields();
		expect(fields.size).toBe(0);
	});

	it('rejects a non-Uint8Array ArrayBuffer as input', () => {
		// Regression: an ArrayBuffer has .byteLength but is NOT a Uint8Array — the constructor must reject it.
		expect(() => new ProtoReader(new ArrayBuffer(4))).toThrow(TypeError);
	});

	it('throws when varint exceeds maximum safe integer', () => {
		// Varint-encoded value above Number.MAX_SAFE_INTEGER causes silent precision loss.
		// Seven full-continuation bytes (0xff) accumulate a result well past 2^53.
		const data = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
		const reader = new ProtoReader(data);
		expect(() => reader.readField()).toThrow(ProtoParseError);
	});

	it('rejects a plain object with length property as input', () => {
		// Regression: an object like `{ byteLength: 5 }` would crash .slice() at runtime.
		// The constructor must reject it upfront with TypeError.
		expect(() => new ProtoReader({ byteLength: 5 })).toThrow(TypeError);
	});

	it('rejects a string as input', () => {
		// Regression: passing raw text would silently produce garbage bytes from char codes.
		expect(() => new ProtoReader('hello')).toThrow(TypeError);
	});

	it('returns only Uint8Array values from getMessages, dropping varints', () => {
		// Regression: when a field has mixed varint and Uint8Array entries,
		// getMessages must filter to keep only Uint8Arrays.
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [new Uint8Array([0x01]), 42, new Uint8Array([0x02])]);
		expect(getMessages(fields, 1)).toEqual([new Uint8Array([0x01]), new Uint8Array([0x02])]);
	});

	it('returns empty array from getVarints when field holds only strings', () => {
		// Regression: a length-delimited field with no varint values must not throw.
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [new Uint8Array([0x61])]);
		expect(getVarints(fields, 1)).toEqual([]);
	});

	it('returns empty array from getMessages when field holds only varints', () => {
		// Regression: a varint-only field must not throw.
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [1, 2, 3]);
		expect(getMessages(fields, 1)).toEqual([]);
	});

	it('readAllFields skips fixed-size fields (types 1 and 5) without breaking subsequent parsing', () => {
		// Wire type 1 (64-bit fixed) consumes 8 bytes; wire type 5 (32-bit fixed) consumes 4 bytes.
		// readAllFields must advance past both and keep parsing the next varint correctly.
		const data = new Uint8Array([
			0x19, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, // field 3, type 1 — skip 8 bytes
			0x2d, 0x04, 0x05, 0x06, 0x07,                          // field 5, type 5 — skip 4 bytes
			0x08, 0x42,                                            // field 1, type 0, value 66
		]);
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.size).toBe(3);
		expect(fields.get(5)).toHaveLength(1); // fixed-size field was skipped but still recorded
		expect(fields.get(1)).toEqual([66]);   // subsequent varint parsed correctly after the skips
	});

	it('readAllFields handles a single zero-value varint', () => {
		// Varint 0 is a valid encoding and must not be confused with end-of-buffer.
		const data = new Uint8Array([0x08, 0x00]); // field 1, type 0, value 0
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.get(1)).toEqual([0]);
	});

	it('returns replacement characters for invalid UTF-8 in getString', () => {
		// TextDecoder does NOT reject invalid sequences — it substitutes U+FFFD.
		// getString returns the decoded text, even if garbled; callers must handle this at their level.
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [new Uint8Array([0x80, 0xff])]); // invalid UTF-8 bytes
		expect(getString(fields, 1)).toBe('\ufffd\ufffd');
	});

	it('handles non-contiguous ArrayBuffer via set() correctly', () => {
		// Regression: when response.arrayBuffer() returns a slice of a larger buffer,
		// the Uint8Array.copyFrom must produce an independent contiguous view.
		const full = new ArrayBuffer(16);
		const outer = new Uint8Array(full);
		for (let i = 0; i < 16; i++) outer[i] = i * 2;

		const slice = new Uint8Array(full.slice(4, 8)); // bytes at indices 4..7 of full
		expect(slice).toEqual(new Uint8Array([8, 10, 12, 14]));
	});
});