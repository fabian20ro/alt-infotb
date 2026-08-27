import { describe, it, expect } from 'vitest';
import {
	ProtoReader,
	ProtoParseError,
	decodeFixed32Float,
	getFixed32Float,
	decodeFixed64Double,
	getFixed64Double,
	getVarbool,
	getVarint,
	getMessages,
	getString,
	getVarints
} from './proto.js';

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

	it('getVarbool returns true for non-zero varint', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [42]);
		expect(getVarbool(fields, 1)).toBe(true);
	});

	it('getVarbool returns false for zero varint', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [0]);
		expect(getVarbool(fields, 1)).toBe(false);
	});

	it('getVarbool returns undefined when field holds a string', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [new Uint8Array([0x61])]);
		expect(getVarbool(fields, 1)).toBeUndefined();
	});

	it('getVarbool returns undefined when field is absent', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		expect(getVarbool(fields, 99)).toBeUndefined();
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

	it('decodes multi-byte UTF-8 sequences in getString', () => {
		// Real-world protobuf strings often contain non-ASCII characters.
		// "é" = 0xC3 0xA9 (2 bytes), "€" = 0xE2 0x82 0xAC (3 bytes).
		const utf8Bytes = new Uint8Array([
			0xc3, 0xa9, // é
			0xe2, 0x82, 0xac // €
		]);
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [utf8Bytes]);
		expect(getString(fields, 1)).toBe('é€');
	});

	it('readAllFields handles multiple zero-value varints on different fields', () => {
		// Varint 0 is valid encoding; multiple zero-value fields must all parse correctly.
		// Field number = tag >> 3; wire type = tag & 7. Field 4, varint 0 → 0x20, 0x00.
		const data = new Uint8Array([
			0x08, 0x00, // field 1, value 0
			0x12, 0x03, 0x61, 0x62, 0x63, // field 2, "abc"
			0x20, 0x00, // field 4, value 0
		]);
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.get(1)).toEqual([0]);
		expect(fields.get(2)).toEqual([new Uint8Array([0x61, 0x62, 0x63])]);
		expect(fields.get(4)).toEqual([0]);
	});

	it('getMessages returns empty array when field exists but holds only varints', () => {
		// When a repeated message field contains no Uint8Array entries, getMessages must return [].
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [42, 99]); // purely numeric
		expect(getMessages(fields, 1)).toEqual([]);
	});

	it('getMessages returns empty array when field does not exist', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(2, [new Uint8Array([0x01])]); // only field 2 exists
		expect(getMessages(fields, 99)).toEqual([]);
	});

	it('getString returns empty string for zero-length Uint8Array', () => {
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [new Uint8Array([])]); // empty bytes → empty string
		expect(getString(fields, 1)).toBe('');
	});

	it('decodes multi-byte varint values (>127) in readField', () => {
		// Value 300 = 0xAC 0x02 (two-byte varint). Tests the shift/accumulate path.
		const data = new Uint8Array([0x08, 0xac, 0x02]); // field 1, type 0, value 300
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(1);
		expect(field?.wireType).toBe(0);
		expect(field?.value).toBe(300);
	});

	it('readAllFields accumulates multi-byte varints across fields', () => {
		// Value 256 = 0x80 0x02; value 33554431 = 0xFF 0xFF 0xFF 0x0F.
		const data = new Uint8Array([
			0x08, 0x80, 0x02, // field 1, type 0, value 256
			0x12, 0x03, 0x41, 0x42, 0x43, // field 2, "ABC"
			0x28, 0xff, 0xff, 0xff, 0x0f, // field 5, type 0, value 33554431
		]);
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.get(1)).toEqual([256]);
		expect(fields.get(2)).toEqual([new Uint8Array([0x41, 0x42, 0x43])]);
		expect(fields.get(5)).toEqual([33554431]);
	});

	it('decodes a large varint value near safe boundary', () => {
		// Value 8388607 (2^23 - 1). Varint encoding: 0xFF 0xFF 0xFF 0x03.
		const data = new Uint8Array([
			0x08, // field 1, type 0
			0xff, 0xff, 0xff, 0x03, // value = 8388607 (4-byte varint)
		]);
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(1);
		expect(field?.wireType).toBe(0);
		expect(field?.value).toBe(8388607);
	});

	it('throws ProtoParseError when varint value exceeds MAX_SAFE_INTEGER', () => {
		// Eight full-continuation bytes accumulate to well above 2^53.
		const data = new Uint8Array([
			0x08, // field 1, type 0
			0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // overflow
		]);
		const reader = new ProtoReader(data);
		expect(() => reader.readField()).toThrow(ProtoParseError);
	});

	it('readAllFields handles zero-value varint in a multi-field message', () => {
		// Mix of zero varints and non-zero values on different fields.
		const data = new Uint8Array([
			0x08, 0x00, // field 1, value 0
			0x12, 0x04, 0xf0, 0xde, 0xad, 0xbe, // field 2, "binary blob"
			0x20, 0x00, // field 4, value 0
		]);
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.get(1)).toEqual([0]);
		expect(fields.get(2)).toHaveLength(1);
		expect((fields.get(2)![0] as Uint8Array).byteLength).toBe(4);
		expect(fields.get(4)).toEqual([0]);
	});

	it('parses multi-byte tag varint (field > 15, wire type 0)', () => {
		// Field 20 encoded as a two-byte tag varint (tag value = 0xA0).
		// Tag bytes [0xA0, 0x01] → fieldNumber=20, wireType=0; value=42.
		const data = new Uint8Array([0xa0, 0x01, 0x2a]); // tag + varint(42)
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(20);
		expect(field?.wireType).toBe(0);
		expect(field?.value).toBe(42);
		expect(reader.done).toBe(true);
	});

	it('parses three-byte tag varint (large field number)', () => {
		// Field 1000 encoded as a two-byte tag varint (tag value = 8000 = 0xC0 0x3E).
		const data = new Uint8Array([0xc0, 0x3e, 0x80, 0x02]); // field 1000, type 0, value 256
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(1000);
		expect(field?.wireType).toBe(0);
		expect(field?.value).toBe(256);
		expect(reader.done).toBe(true);
	});

	it('parses consecutive 32-bit fixed-size fields via readField', () => {
		// Two consecutive wire type 5 (32-bit fixed) fields must each consume exactly 4 bytes.
		const data = new Uint8Array([
			0x0d, // field 1, type 5
			0x01, 0x02, 0x03, 0x04, // first fixed value
			0x15, // field 2, type 5 (tag = (2 << 3) | 5 = 21 = 0x15)
			0x05, 0x06, 0x07, 0x08, // second fixed value
		]);
		const reader = new ProtoReader(data);
		const f1 = reader.readField();
		expect(f1?.fieldNumber).toBe(1);
		expect(f1?.wireType).toBe(5);
		const f2 = reader.readField();
		expect(f2?.fieldNumber).toBe(2);
		expect(f2?.wireType).toBe(5);
		expect(reader.done).toBe(true);
	});

	it('parses multi-byte tag with length-delimited content', () => {
		// Field 16, wire type 2: two-byte tag varint (tag=130) + length varint + payload.
		// Tag [0x82, 0x01] → fieldNumber=16, wireType=2; length=3; "xyz".
		const data = new Uint8Array([0x82, 0x01, 0x03, 0x78, 0x79, 0x7a]); // tag + len(3) + "xyz"
		const reader = new ProtoReader(data);
		const field = reader.readField();
		expect(field?.fieldNumber).toBe(16);
		expect(field?.wireType).toBe(2);
		expect(field?.value).toEqual(new Uint8Array([0x78, 0x79, 0x7a]));
		expect(reader.done).toBe(true);
	});

	it('readAllFields handles consecutive multi-byte tag varints without state loss', () => {
		// Two multi-byte tag varints back-to-back must each parse their full tag + value.
		// Field 20 (tag=0xA0,0x01), value=1; then field 1 (tag=0x08), value=99.
		const data = new Uint8Array([0xa0, 0x01, 0x01, 0x08, 0x63]); // tags + values
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.get(20)).toEqual([1]);
		expect(fields.get(1)).toEqual([99]);
	});

	it('getVarint returns undefined when all field entries are Uint8Array', () => {
		// Regression: a field holding multiple Uint8Arrays must not return the first one as a number.
		const fields = new Map<number, Array<number | Uint8Array>>();
		fields.set(1, [new Uint8Array([0x01]), new Uint8Array([0x02])]);
		expect(getVarint(fields, 1)).toBeUndefined();
	});

	it('zero-length length-delimited field between non-empty fields parses correctly', () => {
		// An empty embedded sub-message (length=0) must not consume or corrupt subsequent bytes.
		const data = new Uint8Array([
			0x12, 0x03, 0x41, 0x42, 0x43, // field 2, "ABC"
			0x12, 0x00,                      // field 2, empty sub-message
			0x12, 0x01, 0x58,                  // field 2, single byte "X"
		]);
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.get(2)).toHaveLength(3);
		expect(getString(fields, 2)).toBe('ABC');
		expect((fields.get(2)![1] as Uint8Array).byteLength).toBe(0);
		expect((fields.get(2)![2] as Uint8Array)[0]).toBe(0x58);
	});

	it('readAllFields skips consecutive type-1 fixed-size fields without state loss', () => {
		// Fixed-size (type 1) values are stored as position indices. Two consecutive ones on different field numbers,
		// followed by a varint on the first field, must parse all three correctly in order.
		const data = new Uint8Array([
			0x09, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, // field 1, type 1 (skip 8 bytes)
			0x21, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, // field 4, type 1 (skip 8 bytes)
			0x08, 0x42,                                              // field 1, varint value 66
		]);
		const reader = new ProtoReader(data);
		const fields = reader.readAllFields();
		expect(fields.get(4)).toHaveLength(1);   // position index stored as number
		expect(typeof fields.get(4)![0]).toBe('number');
		expect((fields.get(1) as number[]).length).toBe(2);  // position + varint
		expect((fields.get(1) as number[])[1]).toBe(66);       // second entry is the varint value
	});
});

describe('fixed64 doubles', () => {
	it('decodes a little-endian fixed64 double from a protobuf field offset', () => {
		const payload = new Uint8Array(8);
		new DataView(payload.buffer).setFloat64(0, 44.4268, true);
		const data = new Uint8Array([0x11, ...payload]);
		const fields = new ProtoReader(data).readAllFields();

		expect(getFixed64Double(fields, 2, data)).toBeCloseTo(44.4268, 10);
		expect(decodeFixed64Double(data, 1)).toBeCloseTo(44.4268, 10);
	});

	it('respects Uint8Array byte offsets when decoding', () => {
		const backing = new Uint8Array(20);
		const slice = backing.subarray(5, 14);
		slice[0] = 0x19;
		new DataView(slice.buffer, slice.byteOffset + 1, 8).setFloat64(0, 26.1025, true);
		const fields = new ProtoReader(slice).readAllFields();

		expect(getFixed64Double(fields, 3, slice)).toBeCloseTo(26.1025, 10);
	});

	it('rejects out-of-bounds offsets and returns undefined for an absent field', () => {
		const data = new Uint8Array(8);
		expect(() => decodeFixed64Double(data, 1)).toThrow(ProtoParseError);
		expect(getFixed64Double(new Map(), 2, data)).toBeUndefined();
	});
});

describe('fixed32 floats', () => {
	it('decodes a little-endian fixed32 float from a protobuf field offset', () => {
		// Wire type 5 (32-bit fixed) stores the payload start index; the payload decodes as little-endian float32.
		const payload = new Uint8Array(4);
		new DataView(payload.buffer).setFloat32(0, 3.25, true);
		const data = new Uint8Array([0x0d, ...payload]); // field 1, wire type 5, tag = 13
		const fields = new ProtoReader(data).readAllFields();

		expect(getFixed32Float(fields, 1, data)).toBeCloseTo(3.25, 5);
		expect(decodeFixed32Float(data, 1)).toBeCloseTo(3.25, 5);
	});

	it('rejects invalid offsets and returns undefined for an absent field', () => {
		// Offsets outside the 4-byte payload window are rejected; a missing field number yields undefined.
		const data = new Uint8Array(4);
		expect(() => decodeFixed32Float(data, 1)).toThrow(ProtoParseError);
		expect(() => decodeFixed32Float(data, -1)).toThrow(ProtoParseError);
		expect(() => decodeFixed32Float(data, 0.5)).toThrow(ProtoParseError);
		expect(decodeFixed32Float(data, 0)).toBeCloseTo(0, 5);
		expect(getFixed32Float(new Map(), 1, data)).toBeUndefined();
	});
});
