/**
 * Discovery script: Find all subway stop IDs from the STB API.
 *
 * The STB API uses internal stop IDs for subway stations that differ from
 * GTFS parent station IDs. This script brute-force scans a range of IDs
 * and reports which ones return SUBWAY_STATION data.
 *
 * Usage: npx tsx scripts/discover-subway-stops.ts [start] [end]
 * Default range: 9500-9700
 *
 * Output: JSON mapping of station name → stop IDs with line info
 */

const STB_API_BASE = 'https://info.stb.ro/api/web/v2-6';

const STB_AUTH = {
	APP_ID: 'b32cc233-00d7-4640-bf90-374572668c30',
	APP_KEY: 'gcALgRyZHC,qFonZ=Jde',
	AUTH_PATH: '/proxy/user/auth'
} as const;

const STB_HEADERS: Record<string, string> = {
	'App-Id': STB_AUTH.APP_ID,
	'App-Version': '0.0.0',
	'Device-Name': 'Chrome',
	Lang: 'ro',
	'OS-Type': 'Web',
	'OS-Version': 'web',
	Source: 'ro.radcom.smartcity.web'
};

interface SubwayStop {
	stopId: number;
	name: string;
	lines: Array<{ line: string; direction: string }>;
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

interface ProtoField {
	fieldNumber: number;
	wireType: number;
	value: number | Uint8Array;
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
			break;
		}
	}
	return fields;
}

function tryDecodeString(data: Uint8Array): string | null {
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
		if (/^[\x20-\x7E\u00C0-\u024F\u0300-\u036F\s]+$/.test(text) && text.length > 0) {
			return text;
		}
	} catch {
		// Not valid UTF-8
	}
	return null;
}

async function authenticate(): Promise<string> {
	const res = await fetch(`${STB_API_BASE}${STB_AUTH.AUTH_PATH}`, {
		headers: { 'App-key': STB_AUTH.APP_KEY, 'App-Id': STB_AUTH.APP_ID }
	});
	if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
	const json = (await res.json()) as { data: { userInfo: string } };
	return json.data.userInfo;
}

async function testStopId(
	stopId: number,
	token: string
): Promise<SubwayStop | null> {
	const url = `${STB_API_BASE}/lines/stop?stop_id=${stopId}`;
	const res = await fetch(url, {
		headers: { ...STB_HEADERS, 'User-Info': token }
	});

	if (res.status === 412) throw new Error('TOKEN_EXPIRED');
	if (!res.ok) return null;

	const buf = new Uint8Array(await res.arrayBuffer());
	if (buf.length === 0) return null;

	const fields = readAllFields(buf);

	// Check if it's a subway station (field 5 = "SUBWAY_STATION")
	const typeField = fields.find((f) => f.fieldNumber === 5 && f.wireType === 2);
	if (!typeField) return null;
	const stationType = tryDecodeString(typeField.value as Uint8Array);
	if (stationType !== 'SUBWAY_STATION') return null;

	// Get station name
	const nameField = fields.find((f) => f.fieldNumber === 1 && f.wireType === 2);
	const name = nameField ? tryDecodeString(nameField.value as Uint8Array) ?? '?' : '?';

	// Get line info
	const lineMessages = fields.filter((f) => f.fieldNumber === 10 && f.wireType === 2);
	const lines: Array<{ line: string; direction: string }> = [];

	for (const lm of lineMessages) {
		const subFields = readAllFields(lm.value as Uint8Array);
		const lineNameField = subFields.find((f) => f.fieldNumber === 1 && f.wireType === 2);
		const dirField = subFields.find((f) => f.fieldNumber === 5 && f.wireType === 2);
		const lineName = lineNameField
			? tryDecodeString(lineNameField.value as Uint8Array) ?? '?'
			: '?';
		const direction = dirField
			? tryDecodeString(dirField.value as Uint8Array) ?? '?'
			: '?';
		lines.push({ line: lineName, direction });
	}

	return { stopId, name, lines };
}

async function main() {
	const start = parseInt(process.argv[2] ?? '9500', 10);
	const end = parseInt(process.argv[3] ?? '9700', 10);
	const BATCH_SIZE = 10;

	console.log(`\n=== Subway Stop Discovery (range ${start}-${end}) ===\n`);

	let token = await authenticate();
	console.log('Authenticated.\n');

	const found: SubwayStop[] = [];

	for (let i = start; i <= end; i += BATCH_SIZE) {
		const batch = Array.from(
			{ length: Math.min(BATCH_SIZE, end - i + 1) },
			(_, j) => i + j
		);

		const results = await Promise.allSettled(
			batch.map(async (id) => {
				try {
					return await testStopId(id, token);
				} catch (err) {
					if (err instanceof Error && err.message === 'TOKEN_EXPIRED') {
						token = await authenticate();
						return await testStopId(id, token);
					}
					return null;
				}
			})
		);

		for (const result of results) {
			if (result.status === 'fulfilled' && result.value) {
				const stop = result.value;
				found.push(stop);
				const lineInfo = stop.lines.map((l) => `${l.line}→${l.direction}`).join(', ');
				console.log(`  ${stop.stopId}: ${stop.name} [${lineInfo}]`);
			}
		}

		process.stdout.write(`  Scanned ${Math.min(i + BATCH_SIZE - 1, end)}/${end}\r`);
	}

	console.log(`\n\n=== Found ${found.length} subway stops ===\n`);

	// Group by station name
	const grouped: Record<string, SubwayStop[]> = {};
	for (const stop of found) {
		const key = stop.name;
		if (!grouped[key]) grouped[key] = [];
		grouped[key].push(stop);
	}

	// Output as TypeScript mapping
	console.log('// Grouped by station name:');
	for (const [name, stops] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
		const ids = stops.map((s) => s.stopId);
		const allLines = stops.flatMap((s) => s.lines.map((l) => `${l.line}→${l.direction}`));
		console.log(`// ${name}: [${ids.join(', ')}] — ${allLines.join(', ')}`);
	}

	// Output JSON for programmatic use
	console.log('\n// JSON output:');
	console.log(JSON.stringify(grouped, null, 2));
}

main().catch(console.error);
