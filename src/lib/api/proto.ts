/**
 * Minimal protobuf wire-format reader.
 * Only supports wire types 0 (varint) and 2 (length-delimited).
 * Enough to decode the STB stop response.
 */

export interface ProtoField {
	fieldNumber: number;
	wireType: number;
	value: number | Uint8Array;
}

export class ProtoParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProtoParseError";
	}
}

export class ProtoReader {
	private buf: Uint8Array;
	private pos: number;

	constructor(data?: unknown) {
		if (data == null || !(data instanceof Uint8Array)) {
			throw new TypeError('ProtoReader requires a Uint8Array');
		}
		this.buf = data;
		this.pos = 0;
	}

	get done(): boolean {
		return this.pos >= this.buf.length;
	}

	/**
	 * Reads the next field from the buffer.
	 * 
	 * @returns The parsed field or null if end of buffer.
	 * - Type 0 (varint): Returns the decoded number in `value`.
	 * - Type 2 (length-delimited): Returns the slice as a Uint8Array in `value`.
	 * - Type 1/5 (fixed-size): Returns the position (index) of the field start in `value` to allow skipping.
	 */
	readField(): ProtoField | null {
		if (this.done) return null;
		const tag = this.readVarint();
		const fieldNumber = tag >>> 3;
		const wireType = tag & 0x7;

		if (fieldNumber === 0) {
			throw new ProtoParseError('Invalid field number: 0');
		}

		if (wireType === 0) {
			// Varint
			return { fieldNumber, wireType, value: this.readVarint() };
		} else if (wireType === 2) {
			// Length-delimited (string, bytes, or embedded message)
			const len = this.readVarint();
			if (this.pos + len > this.buf.length) {
				throw new ProtoParseError('Invalid length-delimited field: truncated payload');
			}
			const value = this.buf.slice(this.pos, this.pos + len);
			this.pos += len;
			return { fieldNumber, wireType, value };
		} else if (wireType === 1 || wireType === 5) {
			// Fixed-size: wire type 1 = 8 bytes (64-bit), wire type 5 = 4 bytes (32-bit).
			const size = wireType === 1 ? 8 : 4;
			const label = wireType === 1 ? '64-bit' : '32-bit';
			if (this.pos + size > this.buf.length) {
				throw new ProtoParseError(`Invalid ${label}-bit fixed field: truncated payload`);
			}
			const value = this.pos;
			this.pos += size;
			return { fieldNumber, wireType, value };
		} else {
			// Unknown wire type — can't continue
			throw new ProtoParseError(`Unknown wire type: ${wireType}`);
		}
	}

	private readVarint(): number {
		let result = 0;
		let shift = 0;
		while (this.pos < this.buf.length) {
			const byte = this.buf[this.pos++];
			result += (byte & 0x7f) * Math.pow(2, shift);
			if ((byte & 0x80) === 0) return result;
			shift += 7;
			if (result > Number.MAX_SAFE_INTEGER || shift > 35) {
				throw new ProtoParseError('Varint exceeds maximum safe integer');
			}
		}
		throw new ProtoParseError('Truncated varint: buffer ended before terminating byte');
	}

	/** Read all fields into a map of fieldNumber → values */
	readAllFields(): Map<number, Array<number | Uint8Array>> {
		const fields = new Map<number, Array<number | Uint8Array>>();
		while (!this.done) {
			const field = this.readField();
			if (!field) break;
			const existing = fields.get(field.fieldNumber);
			if (existing) {
				existing.push(field.value);
			} else {
				fields.set(field.fieldNumber, [field.value]);
			}
		}
		return fields;
	}
}

/** Decode Uint8Array as UTF-8 string */
export function decodeString(data: Uint8Array): string {
	return new TextDecoder().decode(data);
}

/** Get first varint value for a field number, or undefined */
export function getVarint(fields: Map<number, Array<number | Uint8Array>>, num: number): number | undefined {
	const v = fields.get(num)?.[0];
	return typeof v === 'number' ? v : undefined;
}

/** Get first string value for a field number, or undefined */
export function getString(fields: Map<number, Array<number | Uint8Array>>, num: number): string | undefined {
	const vals = fields.get(num);
	if (!vals || vals.length === 0) return undefined;
	const v = vals[0];
	return v instanceof Uint8Array ? decodeString(v) : undefined;
}

/** Get all length-delimited values for a field number (for repeated sub-messages) */
export function getMessages(fields: Map<number, Array<number | Uint8Array>>, num: number): Uint8Array[] {
	const vals = fields.get(num);
	if (!vals) return [];
	return vals.filter((v): v is Uint8Array => v instanceof Uint8Array);
}

/** Get all varint values for a field number */
export function getVarints(fields: Map<number, Array<number | Uint8Array>>, num: number): number[] {
	const vals = fields.get(num);
	if (!vals) return [];
	return vals.filter((v): v is number => typeof v === 'number');
}

/** Get first boolean value for a field number (varint 0→false, anything else→true), or undefined */
export function getVarbool(fields: Map<number, Array<number | Uint8Array>>, num: number): boolean | undefined {
	const v = fields.get(num)?.[0];
	return typeof v === 'number' ? Boolean(v) : undefined;
}

/** Decode a protobuf fixed64 payload as a little-endian IEEE-754 double. */
export function decodeFixed64Double(data: Uint8Array, offset: number): number {
	if (!(data instanceof Uint8Array)) {
		throw new TypeError('decodeFixed64Double requires a Uint8Array');
	}
	if (!Number.isInteger(offset) || offset < 0 || offset + 8 > data.byteLength) {
		throw new ProtoParseError('Invalid fixed64 double offset');
	}
	const view = new DataView(data.buffer, data.byteOffset + offset, 8);
	return view.getFloat64(0, true);
}

/** Decode a protobuf fixed32 payload as a little-endian IEEE-754 float. */
export function decodeFixed32Float(data: Uint8Array, offset: number): number {
	if (!(data instanceof Uint8Array)) {
		throw new TypeError('decodeFixed32Float requires a Uint8Array');
	}
	if (!Number.isInteger(offset) || offset < 0 || offset + 4 > data.byteLength) {
		throw new ProtoParseError('Invalid fixed32 float offset');
	}
	const view = new DataView(data.buffer, data.byteOffset + offset, 4);
	return view.getFloat32(0, true);
}

/** Get the first fixed64 double for a schema-known field, or undefined. */
export function getFixed64Double(
	fields: Map<number, Array<number | Uint8Array>>,
	num: number,
	source: Uint8Array
): number | undefined {
	const offset = fields.get(num)?.[0];
	return typeof offset === 'number' ? decodeFixed64Double(source, offset) : undefined;
}

/** Get the first fixed32 float for a schema-known field, or undefined. */
export function getFixed32Float(
	fields: Map<number, Array<number | Uint8Array>>,
	num: number,
	source: Uint8Array
): number | undefined {
	const offset = fields.get(num)?.[0];
	return typeof offset === 'number' ? decodeFixed32Float(source, offset) : undefined;
}

/** Get the first string from a repeated length-delimited field, or undefined. */
export function getStringField(
	fields: Map<number, Array<number | Uint8Array>>,
	num: number
): string | undefined {
	const vals = fields.get(num);
	if (!vals) return undefined;
	for (const v of vals) {
		if (v instanceof Uint8Array) return decodeString(v);
	}
	return undefined;
}

/** Get all strings from a repeated length-delimited field. */
export function getStrings(
	fields: Map<number, Array<number | Uint8Array>>,
	num: number
): string[] {
	const vals = fields.get(num);
	if (!vals) return [];
	const result: string[] = [];
	for (const v of vals) {
		if (v instanceof Uint8Array) result.push(decodeString(v));
	}
	return result;
}

/** Get the first sub-message from a repeated length-delimited field, or undefined. */
export function getFirstSubMessage(
	fields: Map<number, Array<number | Uint8Array>>,
	num: number
): Map<number, Array<number | Uint8Array>> | undefined {
	const vals = fields.get(num);
	if (!vals) return undefined;
	for (const v of vals) {
		if (v instanceof Uint8Array) return new ProtoReader(v).readAllFields();
	}
	return undefined;
}

/** Get all sub-messages from a repeated length-delimited field. */
export function getSubMessages(
	fields: Map<number, Array<number | Uint8Array>>,
	num: number
): Array<Map<number, Array<number | Uint8Array>>> {
	const vals = fields.get(num);
	if (!vals) return [];
	const result: Array<Map<number, Array<number | Uint8Array>>> = [];
	for (const v of vals) {
		if (v instanceof Uint8Array) result.push(new ProtoReader(v).readAllFields());
	}
	return result;
}
