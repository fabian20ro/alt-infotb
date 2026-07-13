/**
 * Integration tests that call the real STB API.
 * These require network access and are excluded from `npm test`.
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createStbServerHeaders, STB_AUTH_PATH, STOP_ID, PROTO_FIELDS } from './constants.js';
import { ProtoReader, getString, getVarint, getMessages } from './proto.js';

const STB_API_BASE = 'https://info.stb.ro/api/web/v2-6';
const STB_API_URL = `${STB_API_BASE}/lines/stop?stop_id=${STOP_ID}`;

const APP_ID = process.env.STB_APP_ID ?? '';
const APP_KEY = process.env.STB_APP_KEY ?? '';
const STB_SERVER_HEADERS = createStbServerHeaders(APP_ID);

/** Fetch a User-Info auth token from the STB auth endpoint */
async function fetchAuthToken(): Promise<string> {
	const res = await fetch(`${STB_API_BASE}${STB_AUTH_PATH}`, {
		headers: { 'App-key': APP_KEY, 'App-Id': APP_ID }
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
		expect(authToken).toMatch(/^\\$2[aby]\\$\\d+\\$/);
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

		const address = getString(fields, STOP.ADDRESS);
		expect(address).toBeTruthy();

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

	it('decodes real arrival data with line entries', async () => {
		const headers = { ...STB_SERVER_HEADERS, 'User-Info': authToken };
		const response = await fetch(STB_API_URL, { headers });
		const buf = new Uint8Array(await response.arrayBuffer());

		const reader = new ProtoReader(buf);
		const fields = reader.readAllFields();
		const { STOP, LINE } = PROTO_FIELDS;

		const lineMessages = getMessages(fields, STOP.LINES);
		expect(lineMessages.length).toBeGreaterThan(0);

		for (const lineData of lineMessages) {
			const lineReader = new ProtoReader(lineData);
			const lineFields = lineReader.readAllFields();

			const lineName = getString(lineFields, LINE.NAME);
			expect(lineName).toBeTruthy();

			const vehicleType = getString(lineFields, LINE.VEHICLE_TYPE);
			expect(vehicleType).toBeTruthy();

			const direction = getString(lineFields, LINE.DIRECTION);
			expect(direction).toBeTruthy();
		}
	});

	it('has arrival times in field 9 sub-messages with sensible values', async () => {
		const headers = { ...STB_SERVER_HEADERS, 'User-Info': authToken };
		const response = await fetch(STB_API_URL, { headers });
		const buf = new Uint8Array(await response.arrayBuffer());

		const reader = new ProtoReader(buf);
		const fields = reader.readAllFields();
		const { STOP, LINE, ARRIVAL } = PROTO_FIELDS;

		const lineMessages = getMessages(fields, STOP.LINES);
		let totalArrivals = 0;

		for (const lineData of lineMessages) {
			const lineReader = new ProtoReader(lineData);
			const lineFields = lineReader.readAllFields();

			const lineName = getString(lineFields, LINE.NAME) ?? '?';
			const arrivalMessages = getMessages(lineFields, LINE.ARRIVALS);

			for (const arrivalData of arrivalMessages) {
				const arrivalReader = new ProtoReader(arrivalData);
				const arrivalFields = arrivalReader.readAllFields();

				// Each arrival must carry a schedule-flag sub-field (0=realtime, 1=estimated)
				const isScheduled = getVarint(arrivalFields, ARRIVAL.IS_SCHEDULED);
				expect(isScheduled).toBeDefined();
				expect([0, 1]).toContain(isScheduled);

				const seconds = getVarint(arrivalFields, ARRIVAL.SECONDS);

				expect(seconds).toBeDefined();
				// Arrival times should be 0 to 2 hours (7200 seconds)
				expect(seconds).toBeGreaterThanOrEqual(0);
				expect(seconds).toBeLessThanOrEqual(7200);

				totalArrivals++;
			}
		}

		// There should be at least some arrival entries
		expect(totalArrivals).toBeGreaterThan(0);
	});

	it('includes STOP.TYPE per documented schema (field 5)', async () => {
		const headers = { ...STB_SERVER_HEADERS, 'User-Info': authToken };
		const response = await fetch(STB_API_URL, { headers });
		expect(response.status).toBe(200);
		const buf = new Uint8Array(await response.arrayBuffer());

		const reader = new ProtoReader(buf);
		const fields = reader.readAllFields();
		const typeStr = getString(fields, PROTO_FIELDS.STOP.TYPE);
		expect(typeStr).toBeTruthy();
	});

	it('each line entry carries a LINE.ID varint (field 2)', async () => {
		const headers = { ...STB_SERVER_HEADERS, 'User-Info': authToken };
		const response = await fetch(STB_API_URL, { headers });
		expect(response.status).toBe(200);
		const buf = new Uint8Array(await response.arrayBuffer());

		const reader = new ProtoReader(buf);
		const fields = reader.readAllFields();
		const lineMessages = getMessages(fields, PROTO_FIELDS.STOP.LINES);

		for (const lineData of lineMessages) {
			const lineReader = new ProtoReader(lineData);
			const lineFields = lineReader.readAllFields();
			const lineId = getVarint(lineFields, PROTO_FIELDS.LINE.ID);
			expect(lineId).toBeDefined();
			expect(typeof lineId).toBe('number');
		}
	});

	it('returns multiple distinct lines at the configured stop', async () => {
		const headers = { ...STB_SERVER_HEADERS, 'User-Info': authToken };
		const response = await fetch(STB_API_URL, { headers });
		expect(response.status).toBe(200);
		const buf = new Uint8Array(await response.arrayBuffer());

		const reader = new ProtoReader(buf);
		const fields = reader.readAllFields();
		const lineMessages = getMessages(fields, PROTO_FIELDS.STOP.LINES);

		expect(lineMessages.length).toBeGreaterThanOrEqual(2);

		// Each arrival entry must carry a schedule-flag sub-field (0=realtime, 1=estimated)
		for (const lineData of lineMessages) {
			const lineReader = new ProtoReader(lineData);
			const lineFields = lineReader.readAllFields();
			const arrivals = getMessages(lineFields, PROTO_FIELDS.LINE.ARRIVALS);

			for (const arrivalData of arrivals) {
				const arrivalReader = new ProtoReader(arrivalData);
				const arrivalFields = arrivalReader.readAllFields();

				const isScheduled = getVarint(arrivalFields, PROTO_FIELDS.ARRIVAL.IS_SCHEDULED);
				expect(isScheduled).toBeDefined();
				expect([0, 1]).toContain(isScheduled);
			}
		}
	});

	it('full protobuf read completes without throwing (error boundary)', async () => {
		const headers = { ...STB_SERVER_HEADERS, 'User-Info': authToken };
		const response = await fetch(STB_API_URL, { headers });
		expect(response.status).toBe(200);
		const buf = new Uint8Array(await response.arrayBuffer());

		let threw = false;
		try {
			new ProtoReader(buf).readAllFields();
		} catch {
			threw = true;
		}
		expect(threw).toBe(false);
	});
});
