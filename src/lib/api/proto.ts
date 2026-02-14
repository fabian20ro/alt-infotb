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
			const value = this.buf.slice(this.pos, this.pos + len);
			this.pos += len;
			return { fieldNumber, wireType, value };
		} else if (wireType === 1) {
			// 64-bit fixed — skip 8 bytes
			const value = this.pos;
			this.pos += 8;
			return { fieldNumber, wireType, value };
		} else if (wireType === 5) {
			// 32-bit fixed — skip 4 bytes
			const value = this.pos;
			this.pos += 4;
			return { fieldNumber, wireType, value };
		} else {
			// Unknown wire type — can't continue
			return null;
		}
	}

	private readVarint(): number {
		let result = 0;
		let shift = 0;
		while (this.pos < this.buf.length) {
			const byte = this.buf[this.pos++];
			result |= (byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) break;
			shift += 7;
			if (shift > 35) break; // Safety: max 5 bytes for uint32
		}
		return result >>> 0; // Unsigned
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
	const vals = fields.get(num);
	if (!vals || vals.length === 0) return undefined;
	const v = vals[0];
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
