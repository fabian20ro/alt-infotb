/**
 * Integration tests that call the real STB API.
 * These require network access and are excluded from `npm test`.
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { STB_SERVER_HEADERS, STB_AUTH, STOP_ID, PROTO_FIELDS, TRAM_LINES } from './constants.js';
import { ProtoReader, getString, getMessages } from './proto.js';

const STB_API_BASE = 'https://info.stb.ro/api/web/v2-6';
const STB_API_URL = `${STB_API_BASE}/lines/stop?stop_id=${STOP_ID}`;

/** Fetch a User-Info auth token from the STB auth endpoint */
async function fetchAuthToken(): Promise<string> {
	const res = await fetch(`${STB_API_BASE}${STB_AUTH.AUTH_PATH}`, {
		headers: { 'App-key': STB_AUTH.APP_KEY, 'App-Id': STB_AUTH.APP_ID }
	});
	expect(res.status).toBe(200);
	const json = (await res.json()) as { data: { userInfo: string } };
	return json.data.userInfo;
}

describe('STB API (real network)', () => {
	let authToken: string;

	beforeAll(async () => {
		authToken = await fetchAuthToken();
	});

	it('auth endpoint returns a bcrypt token', () => {
		expect(authToken).toMatch(/^\$2[aby]\$\d+\$/);
	});

	it('returns 200 with valid protobuf when all headers + User-Info are present', async () => {
		const headers = { ...STB_SERVER_HEADERS, 'User-Info': authToken };
		const response = await fetch(STB_API_URL, { headers });

		expect(response.status).toBe(200);

		const buf = new Uint8Array(await response.arrayBuffer());
		expect(buf.length).toBeGreaterThan(0);

		const reader = new ProtoReader(buf);
		const fields = reader.readAllFields();
		const { STOP } = PROTO_FIELDS;

		const stationName = getString(fields, STOP.NAME);
		expect(stationName).toBeTruthy();

		const lineMessages = getMessages(fields, STOP.LINES);
		expect(lineMessages.length).toBeGreaterThan(0);
	});

	it('returns 400 without User-Info header (documents the requirement)', async () => {
		const response = await fetch(STB_API_URL, { headers: STB_SERVER_HEADERS });
		expect(response.status).toBe(400);
	});

	it('returns 400 with no headers at all', async () => {
		const response = await fetch(STB_API_URL);
		expect(response.status).toBe(400);
	});

	it('decodes real arrival data with known tram lines', async () => {
		const headers = { ...STB_SERVER_HEADERS, 'User-Info': authToken };
		const response = await fetch(STB_API_URL, { headers });
		const buf = new Uint8Array(await response.arrayBuffer());

		const reader = new ProtoReader(buf);
		const fields = reader.readAllFields();
		const { STOP, LINE } = PROTO_FIELDS;

		const lineMessages = getMessages(fields, STOP.LINES);
		const lineNames = lineMessages.map((msg) => {
			const lineReader = new ProtoReader(msg);
			const lineFields = lineReader.readAllFields();
			return getString(lineFields, LINE.NAME) ?? '';
		});

		const knownLines = [...TRAM_LINES];
		const matchingLines = lineNames.filter((name) => knownLines.includes(name));
		expect(matchingLines.length).toBeGreaterThan(0);
	});
});
