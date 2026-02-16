/**
 * Diagnostic script: Dump ALL protobuf fields from the STB stop endpoint.
 * Authenticates, fetches stop data, and prints every field number, wire type, and value.
 *
 * Usage: npx tsx scripts/dump-proto.ts [stop_id]
 * Default stop_id: 3570 (Piata Unirii)
 */

import 'dotenv/config';

const STB_API_BASE = 'https://info.stb.ro/api/web/v2-6';
const STB_AUTH_PATH = '/proxy/user/auth';

const APP_ID = process.env.STB_APP_ID;
const APP_KEY = process.env.STB_APP_KEY;

if (!APP_ID || !APP_KEY) {
	console.error('Missing STB_APP_ID or STB_APP_KEY environment variables.');
	console.error('Copy .env.example to .env and fill in the credentials.');
	process.exit(1);
}

const STB_HEADERS: Record<string, string> = {
	'App-Id': APP_ID,
	'App-Version': '0.0.0',
	'Device-Name': 'Chrome',
	Lang: 'ro',
	'OS-Type': 'Web',
	'OS-Version': 'web',
	Source: 'ro.radcom.smartcity.web'
};

const WIRE_TYPE_NAMES: Record<number, string> = {
	0: 'varint',
	1: 'fixed64',
	2: 'length-delimited',
	5: 'fixed32'
};

interface ProtoField {
	fieldNumber: number;
	wireType: number;
	value: number | Uint8Array;
}

function readVarint(buf: Uint8Array, pos: number): [number, number] {
	let result = 0;
	let shift = 0;
	let p = pos;
	while (p < buf.length) {
		const byte = buf[p++];
		result |= (byte & 0x7f) << shift;
		if ((byte & 0x80) === 0) break;
		shift += 7;
		if (shift > 35) break;
	}
	return [result >>> 0, p];
}

function readAllFields(buf: Uint8Array): ProtoField[] {
	const fields: ProtoField[] = [];
	let pos = 0;
	while (pos < buf.length) {
		const [tag, nextPos] = readVarint(buf, pos);
		pos = nextPos;
		const fieldNumber = tag >>> 3;
		const wireType = tag & 0x7;

		if (wireType === 0) {
			const [value, p] = readVarint(buf, pos);
			pos = p;
			fields.push({ fieldNumber, wireType, value });
		} else if (wireType === 2) {
			const [len, p] = readVarint(buf, pos);
			pos = p;
			const value = buf.slice(pos, pos + len);
			pos += len;
			fields.push({ fieldNumber, wireType, value });
		} else if (wireType === 1) {
			pos += 8;
			fields.push({ fieldNumber, wireType, value: 0 });
		} else if (wireType === 5) {
			pos += 4;
			fields.push({ fieldNumber, wireType, value: 0 });
		} else {
			console.error(`Unknown wire type ${wireType} at pos ${pos}`);
			break;
		}
	}
	return fields;
}

function tryDecodeString(data: Uint8Array): string | null {
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
		// Only consider it a string if it has printable characters
		if (/^[\x20-\x7E\u00C0-\u024F\u0300-\u036F\s]+$/.test(text) && text.length > 0) {
			return text;
		}
	} catch {
		// Not valid UTF-8
	}
	return null;
}

function formatValue(field: ProtoField, indent: string): string {
	const wireTypeName = WIRE_TYPE_NAMES[field.wireType] ?? `unknown(${field.wireType})`;

	if (field.wireType === 0) {
		const val = field.value as number;
		// Show as both decimal and potentially as seconds
		const minutes = Math.round(val / 60);
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		let timeStr = '';
		if (val > 0 && val < 36000) {
			timeStr = hours > 0 ? ` (${hours}h ${mins}m = ${minutes} min)` : ` (${minutes} min)`;
		}
		return `${indent}field ${field.fieldNumber} [${wireTypeName}]: ${val}${timeStr}`;
	} else if (field.wireType === 2) {
		const data = field.value as Uint8Array;
		const asString = tryDecodeString(data);
		if (asString !== null) {
			return `${indent}field ${field.fieldNumber} [string]: "${asString}"`;
		}
		// Try parsing as sub-message
		const subFields = readAllFields(data);
		if (subFields.length > 0 && subFields.every((f) => f.fieldNumber > 0 && f.fieldNumber < 100)) {
			const lines = [`${indent}field ${field.fieldNumber} [message] (${data.length} bytes):`];
			for (const sub of subFields) {
				lines.push(formatValue(sub, indent + '  '));
			}
			return lines.join('\n');
		}
		// Raw bytes
		const hex = Array.from(data.slice(0, 32))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join(' ');
		const suffix = data.length > 32 ? '...' : '';
		return `${indent}field ${field.fieldNumber} [bytes] (${data.length}): ${hex}${suffix}`;
	}
	return `${indent}field ${field.fieldNumber} [${wireTypeName}]: ${field.value}`;
}

async function main() {
	const stopId = process.argv[2] ?? '3570';
	console.log(`\n=== STB Proto Dump for stop_id=${stopId} ===\n`);
	console.log(`Timestamp: ${new Date().toISOString()}\n`);

	// Step 1: Authenticate
	console.log('Authenticating...');
	const authRes = await fetch(`${STB_API_BASE}${STB_AUTH_PATH}`, {
		headers: { 'App-key': APP_KEY, 'App-Id': APP_ID }
	});
	if (!authRes.ok) {
		console.error(`Auth failed: ${authRes.status}`);
		process.exit(1);
	}
	const authJson = (await authRes.json()) as { data: { userInfo: string } };
	const token = authJson.data.userInfo;
	console.log(`Auth token: ${token.substring(0, 20)}...\n`);

	// Step 2: Fetch stop data
	const url = `${STB_API_BASE}/lines/stop?stop_id=${stopId}`;
	console.log(`Fetching: ${url}`);
	const res = await fetch(url, {
		headers: { ...STB_HEADERS, 'User-Info': token }
	});
	if (!res.ok) {
		console.error(`API returned: ${res.status}`);
		process.exit(1);
	}

	const buf = new Uint8Array(await res.arrayBuffer());
	console.log(`Response: ${buf.length} bytes\n`);

	// Step 3: Parse and dump ALL fields
	console.log('=== TOP-LEVEL FIELDS ===\n');
	const fields = readAllFields(buf);
	for (const field of fields) {
		console.log(formatValue(field, ''));
	}

	// Step 4: Summary of line sub-messages
	console.log('\n=== LINE ENTRIES SUMMARY ===\n');
	const lineMessages = fields.filter(
		(f) => f.fieldNumber === 10 && f.wireType === 2
	);
	for (let i = 0; i < lineMessages.length; i++) {
		const data = lineMessages[i].value as Uint8Array;
		const subFields = readAllFields(data);

		// Extract key info
		const nameField = subFields.find((f) => f.fieldNumber === 1 && f.wireType === 2);
		const lineName = nameField ? tryDecodeString(nameField.value as Uint8Array) : '?';

		const dirField = subFields.find((f) => f.fieldNumber === 5 && f.wireType === 2);
		const direction = dirField ? tryDecodeString(dirField.value as Uint8Array) : '?';

		console.log(`--- Line ${i + 1}: ${lineName} → ${direction} ---`);

		// Show ALL varint fields (potential arrival times)
		const varintFields = subFields.filter((f) => f.wireType === 0);
		for (const vf of varintFields) {
			const val = vf.value as number;
			const minutes = Math.round(val / 60);
			const hours = Math.floor(minutes / 60);
			const mins = minutes % 60;
			let timeStr = '';
			if (val > 0 && val < 36000) {
				timeStr = hours > 0 ? ` → ${hours}h ${mins}m` : ` → ${minutes} min`;
			}
			console.log(`  field ${vf.fieldNumber}: ${val}${timeStr}`);
		}

		// Show ALL string fields
		const stringFields = subFields.filter((f) => f.wireType === 2);
		for (const sf of stringFields) {
			const str = tryDecodeString(sf.value as Uint8Array);
			if (str) {
				console.log(`  field ${sf.fieldNumber}: "${str}"`);
			}
		}

		// Show ALL sub-messages
		const msgFields = subFields.filter(
			(f) => f.wireType === 2 && !tryDecodeString(f.value as Uint8Array)
		);
		for (const mf of msgFields) {
			const innerFields = readAllFields(mf.value as Uint8Array);
			console.log(`  field ${mf.fieldNumber} [sub-message]:`);
			for (const inner of innerFields) {
				console.log(`    ${formatValue(inner, '    ')}`);
			}
		}

		console.log();
	}
}

main().catch(console.error);
