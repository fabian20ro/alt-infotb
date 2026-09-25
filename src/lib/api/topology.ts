import { ProtoReader, ProtoParseError, decodeFixed64Double, type ProtoField } from './proto.ts';
import { normalizeTransportType, type CanonicalTransportType } from './transport.ts';

export interface StbLine {
	id: number;
	name: string;
	type: CanonicalTransportType | undefined;
	rawType: string;
}

export interface StbStop {
	id: number;
	name: string;
	lat: number;
	lon: number;
	rawType?: string;
}

export interface StbLineTopology extends StbLine {
	stops: StbStop[];
	directionNames: { 0?: string; 1?: string };
}

export interface StbStopMemberships {
	id: number;
	name: string;
	lines: Array<StbLine & { directionId: 0 | 1 }>;
}

type Fields = Map<number, ProtoField[]>;

// Retain wire types: readAllFields cannot distinguish a varint from a fixed64 offset.
function readFields(data: Uint8Array): Fields {
	const reader = new ProtoReader(data);
	const fields: Fields = new Map();
	while (!reader.done) {
		const field = reader.readField()!;
		const values = fields.get(field.fieldNumber) ?? [];
		values.push(field);
		fields.set(field.fieldNumber, values);
	}
	return fields;
}

function values(fields: Fields, number: number, wireType: number): ProtoField[] {
	const result = fields.get(number) ?? [];
	if (result.some((field) => field.wireType !== wireType)) {
		throw new ProtoParseError(`Unexpected wire type for field ${number}; expected ${wireType}`);
	}
	return result;
}

function single(fields: Fields, number: number, wireType: number): ProtoField | undefined {
	const result = values(fields, number, wireType);
	if (result.length > 1) throw new ProtoParseError(`Duplicate singular field ${number}`);
	return result[0];
}

function string(fields: Fields, number: number, required = true): string | undefined {
	const field = single(fields, number, 2);
	if (!field) {
		if (!required) return undefined;
		throw new ProtoParseError(`Missing required string field ${number}`);
	}
	let result: string;
	try {
		result = new TextDecoder('utf-8', { fatal: true }).decode(field.value as Uint8Array).trim();
	} catch {
		throw new ProtoParseError(`Invalid UTF-8 in field ${number}`);
	}
	if (required && !result) throw new ProtoParseError(`Empty required string field ${number}`);
	return result;
}

function positiveId(fields: Fields, number: number): number {
	const value = single(fields, number, 0)?.value;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new ProtoParseError(`Invalid positive ID in field ${number}`);
	}
	return value;
}

function coordinate(fields: Fields, number: number, source: Uint8Array, maximum: number): number {
	const offset = single(fields, number, 1)?.value;
	if (typeof offset !== 'number') throw new ProtoParseError(`Missing coordinate field ${number}`);
	const result = decodeFixed64Double(source, offset);
	if (!Number.isFinite(result) || Math.abs(result) > maximum) {
		throw new ProtoParseError(`Invalid coordinate field ${number}`);
	}
	return result;
}

function line(fields: Fields, idField = 1, nameField = 2): StbLine {
	const rawType = string(fields, 3)!;
	return {
		id: positiveId(fields, idField),
		name: string(fields, nameField)!,
		type: normalizeTransportType(rawType),
		rawType
	};
}

/** RequestGetLinesDTO from the official STB web client's published protobuf schema. */
export function decodeLineRegistry(data: Uint8Array): StbLine[] {
	const lines = values(readFields(data), 1, 2).map((field) => line(readFields(field.value as Uint8Array)));
	if (!lines.length) throw new ProtoParseError('Empty line registry');
	const ids = new Set<number>();
	for (const item of lines) {
		if (ids.has(item.id)) throw new ProtoParseError(`Duplicate registry line ID ${item.id}`);
		ids.add(item.id);
	}
	return lines;
}

/** ResponseGetLineDTO, for both /lines/:id and /lines/:id/direction/:direction. */
export function decodeLineTopology(data: Uint8Array): StbLineTopology {
	const fields = readFields(data);
	const identity = line(fields);
	const stops = values(fields, 12, 2).map((field): StbStop => {
		const source = field.value as Uint8Array;
		const stop = readFields(source);
		return {
			id: positiveId(stop, 1), name: string(stop, 4)!,
			lat: coordinate(stop, 2, source, 90), lon: coordinate(stop, 3, source, 180),
			rawType: string(stop, 6, false)
		};
	});
	if (!stops.length) throw new ProtoParseError(`Empty topology for line ${identity.id}`);
	return {
		...identity, stops,
		directionNames: { 0: string(fields, 10, false), 1: string(fields, 11, false) }
	};
}

/** Positive membership evidence; a named response with no lines is not evidence of removal. */
export function decodeStopMemberships(data: Uint8Array, sourceStopId: number): StbStopMemberships {
	if (!Number.isSafeInteger(sourceStopId) || sourceStopId <= 0) {
		throw new ProtoParseError('Invalid source stop ID');
	}
	const fields = readFields(data);
	const name = string(fields, 1)!;
	const lines = values(fields, 10, 2).map((field): StbLine & { directionId: 0 | 1 } => {
		const entry = readFields(field.value as Uint8Array);
		const directionId = single(entry, 8, 0)?.value;
		if (directionId !== 0 && directionId !== 1) {
			throw new ProtoParseError('Missing or invalid stop membership direction');
		}
		return { ...line(entry, 2, 1), directionId };
	});
	return { id: sourceStopId, name, lines };
}
