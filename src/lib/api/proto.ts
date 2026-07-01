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

	constructor(data: Uint8Array) {
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
		} else if (wireType === 1) {
			// 64-bit fixed — skip 8 bytes
			if (this.pos + 8 > this.buf.length) {
				throw new ProtoParseError('Invalid 64-bit fixed field: truncated payload');
			}
			const value = this.pos;
			this.pos += 8;
			return { fieldNumber, wireType, value };
		} else if (wireType === 5) {
			// 30-bit fixed — skip 4 bytes
			if (this.pos + 4 > this.buf.length) {
				throw new ProtoParseError('Invalid 32-bit fixed field: truncated payload');
			}
			const value = this.pos;
			this.pos += 4;
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
			if (shift > 35) {
				throw new ProtoParseError('Varint too long');
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
