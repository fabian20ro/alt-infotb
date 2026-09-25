import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CollectionError, sha256, type TopologySnapshot } from './catalog-collection.ts';
import { auditStationMembership, formatMembershipAuditMarkdown, type AuditCatalog } from './station-membership-audit.ts';

function varint(value: number): number[] {
	const result: number[] = [];
	do { const byte = value % 128; value = Math.floor(value / 128); result.push(byte | (value ? 128 : 0)); } while (value);
	return result;
}
const integer = (field: number, value: number) => [field << 3, ...varint(value)];
const message = (field: number, value: number[]) => [(field << 3) | 2, ...varint(value.length), ...value];
const string = (field: number, value: string) => message(field, [...new TextEncoder().encode(value)]);
function response(name = 'Stop', lines: Array<{ id: number; name: string; type: string; direction?: number }> = [{ id: 199, name: 'N109', type: 'BUS' }]): Uint8Array {
	return new Uint8Array([...string(1, name), ...lines.flatMap((line) => message(10, [
		...string(1, line.name), ...integer(2, line.id), ...string(3, line.type), ...integer(8, line.direction ?? 0)
	]))]);
}
const instant = '2026-09-25T10:00:00.000Z';
function collector(payloads: Record<number, Uint8Array | Error>) {
	const get = vi.fn(async (path: string): Promise<Uint8Array> => {
		const id = Number(new URL(path, 'http://localhost').searchParams.get('stop_id'));
		const payload = payloads[id];
		if (payload instanceof Error) throw payload;
		if (!payload) throw new Error(`Unexpected stop ${id}`);
		return payload;
	});
	return { get, startedAt: instant, now: () => Date.parse(instant), evidence: new Map(), progress: vi.fn() };
}
function snapshot(stopIds: number[], status: 'complete' | 'inconclusive' = 'complete'): TopologySnapshot {
	return {
		schemaVersion: 1, status, source: 'test', startedAt: instant, completedAt: instant,
		registry: [{ id: 199, name: 'N109', type: 'BUS', rawType: 'BUS' }],
		stops: stopIds.map((id) => ({ id, name: `Stop ${id}`, lat: 44.4, lon: 26.2 })),
		lines: [{ id: 199, directions: { '0': stopIds, '1': stopIds }, allStopIds: stopIds }],
		evidence: [], issues: []
	};
}
const station = (id: number, lines = ['BUS:N109']) => ({ id, name: `Stop ${id}`, lines });

describe('auditStationMembership', () => {
	it('audits every known stop sequentially, not a sample', async () => {
		const stops = Array.from({ length: 125 }, (_, index) => station(index + 1));
		const transport = collector(Object.fromEntries(stops.map((stop) => [stop.id, response()])));
		const report = await auditStationMembership(transport, { stations: stops });
		expect(report.status).toBe('conform');
		expect(report.coverage).toMatchObject({ knownApiStops: 125, requested: 125, verified: 125, unverified: 0, verifiedMarkers: 125 });
		expect(transport.get.mock.calls.map(([path]) => path)).toEqual(stops.map((stop) => `/lines/stop?stop_id=${stop.id}`));
	});
	it('finds the real missing Isovolta memberships with exact identities', async () => {
		const body = readFileSync(new URL('../src/lib/api/fixtures/topology/isovolta-6084.pb', import.meta.url));
		const report = await auditStationMembership(collector({ 6084: body }), { stations: [station(6084, ['BUS:103', 'BUS:246'])] });
		expect(report.status).toBe('nonconform');
		expect(report.discrepancies).toEqual([
			expect.objectContaining({ apiStopId: 6084, stationId: 6084, stationName: 'Isovolta', lineId: 199, lineName: 'N109', rawType: 'BUS', directionId: 1 }),
			expect.objectContaining({ apiStopId: 6084, stationId: 6084, lineId: 889, lineName: '640', directionId: 0 })
		]);
	});
	it('normalizes observed trolleybus types and harmless line-name casing', async () => {
		const report = await auditStationMembership(collector({ 1: response('A', [{ id: 66, name: '66', type: 'CABLE_CAR' }]), 2: response() }),
			{ stations: [station(1, ['TROLLEYBUS:66']), station(2, ['bus:n109'])] });
		expect(report.status).toBe('conform');
	});
	it('uses authoritative IDs even if the display name changes', async () => {
		const catalog: AuditCatalog = { stations: [{ ...station(1, ['BUS:old']), lineIds: [199] }], stb: { lineIds: [199] } };
		expect((await auditStationMembership(collector({ 1: response() }), catalog)).status).toBe('conform');
		catalog.stations[0].lineIds = [];
		catalog.stations[0].lines = ['BUS:N109'];
		const missing = await auditStationMembership(collector({ 1: response() }), catalog);
		expect(missing.status).toBe('nonconform');
		expect(missing.discrepancies[0].comparison).toBe('stb-id');
	});
	it('does not use arbitrary lineIds without the authoritative registry', async () => {
		const report = await auditStationMembership(collector({ 1: response() }), { stations: [{ ...station(1, []), lineIds: [199] }] });
		expect(report.discrepancies[0].comparison).toBe('canonical-key');
	});
	it('deduplicates shared metro platform requests while verifying each physical marker', async () => {
		const platforms = [9653, 9654, 9656, 9657];
		const metro = response('Dristor', [{ id: 1, name: 'M1', type: 'SUBWAY' }]);
		const transport = collector(Object.fromEntries(platforms.map((id) => [id, metro])));
		const report = await auditStationMembership(transport, { stations: [station(14697, ['SUBWAY:M1']), station(14713, ['SUBWAY:M1'])] });
		expect(report.status).toBe('conform');
		expect(report.coverage).toMatchObject({ knownApiStops: 4, requested: 4, catalogMarkers: 2, verifiedMarkers: 2 });
		expect(report.stops.every((stop) => stop.markerIds.length === 2)).toBe(true);
		expect(transport.get).toHaveBeenCalledTimes(4);
	});
	it('does not send unmapped metro parent IDs to the API', async () => {
		const transport = collector({});
		const report = await auditStationMembership(transport, { stations: [station(57001, ['SUBWAY:M5'])] });
		expect(transport.get).not.toHaveBeenCalled();
		expect(report.status).toBe('inconclusive');
		expect(report.unmappedMarkers).toEqual([{ stationId: 57001, name: 'Stop 57001', reason: 'No verified API platform mapping' }]);
		expect(report.coverage.unverifiedMarkers).toBe(1);
	});
	it('uses explicit API mappings and reports both markers affected by a failed shared platform', async () => {
		const report = await auditStationMembership(collector({ 9: response(), 10: new CollectionError('http', 'HTTP 500') }),
			{ stations: [{ ...station(1), apiStopIds: [9, 10, 9] }, { ...station(2), apiStopIds: [9, 10] }] });
		expect(report.coverage).toMatchObject({ knownApiStops: 2, requested: 2, verified: 1, unverified: 1, verifiedMarkers: 0, unverifiedMarkers: 2 });
		expect(report.status).toBe('inconclusive');
	});
	it('keeps new topology stops in the denominator even when catalog markers are absent', async () => {
		const report = await auditStationMembership(collector({ 1: response(), 2: response() }), { stations: [station(1)] }, snapshot([1, 2]));
		expect(report.coverage.knownApiStops).toBe(2);
		expect(report.discrepancies).toEqual([{ code: 'missing-catalog-stop', apiStopId: 2, stationId: null, stationName: 'Stop 2' }]);
		expect(report.status).toBe('nonconform');
	});
	it('binds audit evidence to the exact source snapshot and candidate catalog', async () => {
		const catalog = { stations: [station(1)] };
		const source = snapshot([1]);
		const report = await auditStationMembership(collector({ 1: response() }), catalog, source);
		expect(report.catalogHash).toBe(sha256(JSON.stringify(catalog)));
		expect(report.snapshotHash).toBe(sha256(JSON.stringify(source)));
		expect((await auditStationMembership(collector({ 1: response() }), catalog)).snapshotHash).toBeUndefined();
	});
	it('reports lines absent from the independent registry even if the GTFS membership matches', async () => {
		const report = await auditStationMembership(collector({ 1: response('A', [{ id: 889, name: '640', type: 'BUS' }]) }),
			{ stations: [station(1, ['BUS:640'])] }, snapshot([1]));
		expect(report.status).toBe('inconclusive');
		expect(report.stops[0].issues[0]).toMatchObject({ code: 'unregistered-line' });
		expect(report.discrepancies).toEqual([]);
	});
	it('reports exact directional topology contradictions despite correct union membership', async () => {
		const source = snapshot([1]);
		source.lines[0].directions['0'] = [];
		const report = await auditStationMembership(collector({ 1: response() }), { stations: [station(1)] }, source);
		expect(report.status).toBe('nonconform');
		expect(report.discrepancies).toEqual([expect.objectContaining({
			code: 'topology-contradiction', apiStopId: 1, lineId: 199, directionId: 0
		})]);
	});
	it('includes even edge-only topology IDs and preserves incomplete-source status', async () => {
		const source = snapshot([1, 2], 'inconclusive');
		source.stops = source.stops.filter((stop) => stop.id !== 2);
		const report = await auditStationMembership(collector({ 1: response(), 2: response() }), { stations: [station(1)] }, source);
		expect(report.coverage.knownApiStops).toBe(2);
		expect(report.status).toBe('inconclusive');
		expect(report.issues[0].code).toBe('incomplete-inventory');
	});
	it('keeps unknown enums explicit without hiding valid positive discrepancies from the same stop', async () => {
		const report = await auditStationMembership(collector({ 1: response('A', [
			{ id: 1, name: 'X', type: 'FERRY' }, { id: 199, name: 'N109', type: 'BUS' }
		]) }), { stations: [station(1, [])] });
		expect(report.status).toBe('inconclusive');
		expect(report.stops[0].issues[0]).toMatchObject({ code: 'unknown-type', message: 'Line 1 (X): FERRY' });
		expect(report.discrepancies).toHaveLength(1);
		expect(report.discrepancies[0].lineId).toBe(199);
	});
	it('classifies empty and named zero-line responses as unverified, never deletions', async () => {
		const report = await auditStationMembership(collector({ 1: new Uint8Array(), 2: response('A', []) }), { stations: [station(1), station(2)] });
		expect(report.status).toBe('inconclusive');
		expect(report.coverage.unverified).toBe(2);
		expect(report.discrepancies).toEqual([]);
	});
	it('does not treat absent lines as evidence of removal', async () => {
		const catalog = { stations: [station(1, ['BUS:N109', 'BUS:640'])] };
		const before = JSON.stringify(catalog);
		const report = await auditStationMembership(collector({ 1: response() }), catalog);
		expect(report.status).toBe('conform');
		expect(JSON.stringify(catalog)).toBe(before);
	});
	it.each(['auth', 'budget'])('stops on %s with every remaining target explicitly unverified', async (code) => {
		const transport = collector({ 1: response(), 2: new CollectionError(code, 'Unavailable'), 3: response(), 4: response() });
		const report = await auditStationMembership(transport, { stations: [1, 2, 3, 4].map((id) => station(id)) });
		expect(transport.get).toHaveBeenCalledTimes(2);
		expect(report.coverage).toMatchObject({ requested: 2, knownApiStops: 4, verified: 1, unverified: 3 });
		expect(report.stops.slice(2).every((result) => result.issues[0].code === 'not-requested')).toBe(true);
		expect(report.status).toBe('inconclusive');
	});
	it('continues past individual HTTP/schema failures', async () => {
		const transport = collector({ 1: new CollectionError('http', 'HTTP 404'), 2: new Uint8Array([0]), 3: response() });
		const report = await auditStationMembership(transport, { stations: [1, 2, 3].map((id) => station(id)) });
		expect(transport.get).toHaveBeenCalledTimes(3);
		expect(report.coverage.verified).toBe(1);
		expect(report.stops.slice(0, 2).map((result) => result.issues[0].code)).toEqual(['http', 'schema']);
	});
	it('cannot pass an empty inventory', async () => {
		expect((await auditStationMembership(collector({}), { stations: [] })).status).toBe('inconclusive');
	});
	it('keeps historical checkpoint observation time and only relevant evidence', async () => {
		const transport = collector({ 1: response() });
		transport.evidence.set('/lines/stop?stop_id=1', { path: '/lines/stop?stop_id=1', sha256: 'abc', capturedAt: '2026-09-25T09:00:00.000Z' });
		transport.evidence.set('/lines?lang=ro', { path: '/lines?lang=ro', sha256: 'xyz', capturedAt: instant });
		const report = await auditStationMembership(transport, { stations: [station(1)] });
		expect(report.startedAt).toBe('2026-09-25T09:00:00.000Z');
		expect(report.evidence).toHaveLength(1);
	});
	it('renders exact discrepancies and incomplete coverage in Markdown', async () => {
		const report = await auditStationMembership(collector({ 1: response(), 2: response('B', []) }), { stations: [station(1, []), station(2)] });
		const markdown = formatMembershipAuditMarkdown(report);
		expect(markdown).toContain('**inconclusive**');
		expect(markdown).toContain('2 known; 2 requested; 1 verified; 1 unverified');
		expect(markdown).toContain('| missing-membership | 1 | 1 | Stop | 199 | N109 | BUS | 0 | canonical-key |');
		expect(markdown).toContain('no-memberships');
	});
});
