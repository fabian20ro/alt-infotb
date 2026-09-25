import { describe, expect, it, vi } from 'vitest';
import { CollectionError, sha256, type Collector, type TopologySnapshot } from './catalog-collection.ts';
import { discoverObservedServices } from './service-discovery.ts';
import type { MembershipAuditReport } from './station-membership-audit.ts';
import type { StbLine, StbStop } from '../src/lib/api/topology.ts';

const TIME = '2026-09-25T08:00:00.000Z';
const HASH = sha256('catalog');
const registered: StbLine = { id: 1, name: '1', type: 'BUS', rawType: 'BUS' };
const event: StbLine = { id: 1036, name: 'N700', type: 'BUS', rawType: 'BUS' };
const regional: StbLine = { id: 909, name: '476', type: 'BUS', rawType: 'BUS' };
const city: StbStop = { id: 1, name: 'City', lat: 44.4, lon: 26.1 };
const outside: StbStop = { id: 2, name: 'Regional terminus', lat: 45, lon: 26.6 };
const further: StbStop = { id: 3, name: 'Further terminus', lat: 45.2, lon: 26.7 };
function varint(value: number): number[] {
 const bytes: number[] = [];
 do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value ? 128 : 0)); } while (value);
 return bytes;
}
const integer = (field: number, value: number) => [field << 3, ...varint(value)];
const message = (field: number, bytes: number[]) => [(field << 3) | 2, ...varint(bytes.length), ...bytes];
const string = (field: number, value: string) => message(field, [...new TextEncoder().encode(value)]);
function double(field: number, value: number) {
 const bytes = new Uint8Array(8);
 new DataView(bytes.buffer).setFloat64(0, value, true);
 return [(field << 3) | 1, ...bytes];
}
const identity = (line: StbLine) => [...integer(1, line.id), ...string(2, line.name), ...string(3, line.rawType)];
const registry = (lines: StbLine[]) => new Uint8Array(lines.flatMap(line => message(1, identity(line))));
const topology = (line: StbLine, stops: StbStop[]) => new Uint8Array([
 ...identity(line), ...stops.flatMap(stop => message(12, [...integer(1, stop.id), ...double(2, stop.lat), ...double(3, stop.lon), ...string(4, stop.name)]))
]);
const memberships = (stop: StbStop, lines: StbLine[]) => new Uint8Array([
 ...string(1, stop.name), ...lines.flatMap(line => message(10, [...string(1, line.name), ...integer(2, line.id), ...string(3, line.rawType), ...integer(8, 0)]))
]);
function setup(replace?: (path: string) => Uint8Array | undefined) {
 let now = Date.parse(TIME);
 const snapshot: TopologySnapshot = {
  schemaVersion: 1, status: 'complete', source: 'test:stb', startedAt: TIME, completedAt: TIME,
  registry: [registered], lines: [{ id: 1, directions: { '0': [1], '1': [1] }, allStopIds: [1] }],
  stops: [city], evidence: [], issues: []
 };
 const audit: MembershipAuditReport = {
  schemaVersion: 1, source: snapshot.source, catalogHash: HASH, snapshotHash: sha256(JSON.stringify(snapshot)),
  status: 'inconclusive', inventoryScope: 'catalog-and-topology', startedAt: TIME, completedAt: TIME,
  coverage: { catalogMarkers: 1, verifiedMarkers: 0, unverifiedMarkers: 1, knownApiStops: 1, requested: 1, verified: 0, unverified: 1 },
  unmappedMarkers: [], stops: [{ apiStopId: 1, markerIds: [1], status: 'unverified', name: city.name,
   lines: [{ ...event, directionId: 0 }], issues: [{ code: 'unregistered-line', path: '/lines/stop?stop_id=1', message: 'Not in registry' }] }],
  discrepancies: [], issues: [], evidence: [{ path: '/lines/stop?stop_id=1', sha256: sha256(memberships(city, [event])), capturedAt: TIME }]
 };
 const collector: Collector = {
  source: snapshot.source, startedAt: TIME, now: () => now, evidence: new Map(), progress: undefined,
  get: vi.fn(async (path: string) => {
   let bytes = replace?.(path);
   if (!bytes) {
    if (path === '/lines?lang=ro') bytes = registry([registered]);
    else if (path.startsWith('/lines/1036')) bytes = topology(event, [city, outside]);
    else if (path.startsWith('/lines/909')) bytes = topology(regional, [outside, further]);
    else if (path === '/lines/stop?stop_id=2') bytes = memberships(outside, [event, regional]);
    else if (path === '/lines/stop?stop_id=3') bytes = memberships(further, [regional]);
    else throw new Error(`Unexpected path ${path}`);
   }
   if (!bytes.length) throw new CollectionError('empty', 'Empty response');
   collector.evidence.set(path, { path, sha256: sha256(bytes), capturedAt: new Date(now).toISOString() });
   return bytes;
  })
 };
 return { snapshot, audit, collector, advance: (ms: number) => { now += ms; } };
}
const run = ({ collector, snapshot, audit }: ReturnType<typeof setup>, options = {}) => discoverObservedServices(collector, snapshot, audit, { catalogHash: HASH, ...options });

describe('bounded positive service discovery', () => {
 it('closes a service → regional stop → second service chain, once per identity, without changing catalog inputs', async () => {
  const state = setup();
  const before = JSON.stringify([state.snapshot, state.audit]);
  const report = await run(state);
  expect(report.status).toBe('complete');
  expect(report.services.map(service => [service.id, service.status])).toEqual([[909, 'verified'], [1036, 'verified']]);
  expect(report.services[1].triggerStops).toEqual([1, 2]);
  expect(report.stops.map(stop => stop.apiStopId)).toEqual([2, 3]);
  expect(report.services[0].topology?.stops[1].lat).toBe(45.2);
  expect(report.pendingServices).toEqual([]);
  const paths = vi.mocked(state.collector.get).mock.calls.map(call => call[0]);
  expect(new Set(paths).size).toBe(paths.length);
  expect(paths).not.toContain('/lines/stop?stop_id=1');
  expect(state.collector.get).toHaveBeenLastCalledWith('/lines?lang=ro', true);
  expect(JSON.stringify([state.snapshot, state.audit])).toBe(before);
  expect(report.evidence).toHaveLength(paths.length);
 });
 it.each(['all', '0', '1'])('keeps no partial topology or new stops after empty %s response', async direction => {
  const target = `/lines/1036${direction === 'all' ? '' : `/direction/${direction}`}?lang=ro`;
  const state = setup(path => path === target ? new Uint8Array() : undefined);
  const report = await run(state);
  expect(report.status).toBe('inconclusive');
  expect(report.services[0].topology).toBeUndefined();
  expect(report.services[0].issues).toContainEqual(expect.objectContaining({ code: 'empty', path: target }));
  expect(report.stops).toEqual([]);
 });
 it.each([
  ['wrong ID', { ...event, id: 77 }], ['same display name with other type', { ...event, rawType: 'TRAM', type: 'TRAM' }],
  ['renamed service', { ...event, name: 'N701' }], ['unknown type', { ...event, rawType: 'FUTURE', type: undefined }]
 ] as const)('rejects %s without aliasing', async (_description, line) => {
  const report = await run(setup(path => path.startsWith('/lines/1036') ? topology(line, [city, outside]) : undefined));
  expect(report.status).toBe('inconclusive');
  expect(report.services[0].topology).toBeUndefined();
  expect(report.stops).toEqual([]);
 });
 it.each([
  ['snapshot coordinates', { ...city, lat: 44.8 }], ['snapshot name', { ...city, name: 'Other station' }],
  ['invalid coordinates', { ...city, lat: NaN }]
 ])('rejects conflicting %s before exposing any stop', async (_description, changed) => {
  const report = await run(setup(path => path.startsWith('/lines/1036') ? topology(event, [changed, outside]) : undefined));
  expect(report.status).toBe('inconclusive');
  expect(report.stops).toEqual([]);
 });
 it('rejects coordinate disagreement across direction responses', async () => {
  const report = await run(setup(path => path === '/lines/1036/direction/1?lang=ro' ? topology(event, [city, { ...outside, lon: 27 }]) : undefined));
  expect(report.services[0].issues.some(issue => issue.code === 'stop-conflict')).toBe(true);
  expect(report.stops).toEqual([]);
 });
 it('requires all-detail to equal the union of both directions', async () => {
  const report = await run(setup(path => path === '/lines/1036?lang=ro' ? topology(event, [city]) : undefined));
  expect(report.services[0].issues.some(issue => issue.code === 'direction-coverage')).toBe(true);
  expect(report.stops).toEqual([]);
 });
 it('requires topology to serve its positive trigger stop and direction', async () => {
  const report = await run(setup(path => path.startsWith('/lines/1036') ? topology(event, [outside]) : undefined));
  expect(report.services[0].issues.some(issue => issue.code === 'topology-contradiction')).toBe(true);
 });
 it.each([{ maxRounds: 1 }, { maxServices: 1 }])('reports unvisited services after bounded limits %j', async options => {
  const report = await run(setup(), options);
  expect(report.status).toBe('inconclusive');
  expect(report.pendingServices).toEqual([909]);
  expect(report.services.find(service => service.id === 909)?.topology).toBeUndefined();
 });
 it('reports unvisited new stops after the stop cap', async () => {
  const report = await run(setup(), { maxStops: 1 });
  expect(report.status).toBe('inconclusive');
  expect(report.pendingStops).toEqual([3]);
 });
 it.each(['auth', 'budget'])('stops requests immediately after %s', async code => {
  const state = setup(path => { if (path === '/lines/1036?lang=ro') throw new CollectionError(code, 'Stop'); return undefined; });
  const report = await run(state);
  expect(report.status).toBe('inconclusive');
  expect(state.collector.get).toHaveBeenCalledTimes(1);
  expect(report.issues.some(issue => issue.code === 'registry-not-checked')).toBe(true);
 });
 it('detects registry change even if discovered services otherwise validate', async () => {
  const report = await run(setup(path => path === '/lines?lang=ro' ? registry([registered, event]) : undefined));
  expect(report.status).toBe('inconclusive');
  expect(report.issues.some(issue => issue.code === 'registry-changed')).toBe(true);
 });
 it('never infers retirement from a named empty membership response', async () => {
  const report = await run(setup(path => path === '/lines/stop?stop_id=2' ? memberships(outside, []) : undefined));
  expect(report.status).toBe('inconclusive');
  expect(report.stops[0].issues[0].code).toBe('no-memberships');
  expect(report.services[0].status).toBe('verified');
 });
 it('invalidates a discovered identity when another stop gives it a different name', async () => {
  const report = await run(setup(path => path === '/lines/stop?stop_id=2' ? memberships(outside, [{ ...event, name: 'N701' }]) : undefined));
  expect(report.status).toBe('inconclusive');
  expect(report.services[0].status).toBe('unresolved');
  expect(report.services[0].topology).toBeUndefined();
 });
 it.each(['snapshotHash', 'catalogHash', 'source'] as const)('rejects mismatching audit %s before requesting', async field => {
  const state = setup();
  state.audit[field] = 'invalid';
  const report = await run(state);
  expect(report.issues.some(issue => issue.code === 'input-binding')).toBe(true);
  expect(state.collector.get).not.toHaveBeenCalled();
 });
 it('rejects old captures even on the same transit day', async () => {
  const state = setup(); state.advance(7 * 60 * 60_000);
  expect((await run(state)).issues.some(issue => issue.code === 'stale-input')).toBe(true);
  expect(state.collector.get).not.toHaveBeenCalled();
 });
 it('rejects a previous transit day and detects crossing during discovery', async () => {
  const state = setup();
  state.advance(Date.parse('2026-09-26T00:59:59Z') - Date.parse(TIME));
  const time = new Date(state.collector.now()).toISOString();
  state.snapshot.startedAt = state.snapshot.completedAt = time;
  state.audit.startedAt = state.audit.completedAt = time;
  state.audit.evidence[0].capturedAt = time;
  state.audit.snapshotHash = sha256(JSON.stringify(state.snapshot));
  const get = state.collector.get;
  state.collector.get = async (path, fresh) => { state.advance(500); return get(path, fresh); };
  expect((await run(state)).issues.some(issue => issue.code === 'transit-day-changed')).toBe(true);
 });
 it('keeps unknown seed types unresolved without guessing a transport alias', async () => {
  const state = setup();
  state.audit.stops[0].lines![0] = { ...event, rawType: 'EVENT_BUS', type: undefined, directionId: 0 };
  const report = await run(state);
  expect(report.status).toBe('inconclusive');
  expect(report.services[0].issues[0].code).toBe('unknown-type');
  expect(state.collector.get).toHaveBeenCalledTimes(1);
 });
 it('ignores no failure when malformed positive seeds carry an invalid direction', async () => {
  const state = setup();
  state.audit.stops[0].lines![0].directionId = 2 as 0;
  const report = await run(state);
  expect(report.status).toBe('inconclusive');
  expect(report.issues.some(issue => issue.code === 'invalid-seed')).toBe(true);
  expect(report.services).toEqual([]);
 });
 it('does not borrow pre-existing evidence for a failed fresh registry request', async () => {
  const state = setup(path => { if (path === '/lines?lang=ro') throw new CollectionError('http', 'Unavailable'); return undefined; });
  state.collector.evidence.set('/lines?lang=ro', { path: '/lines?lang=ro', sha256: sha256('old registry'), capturedAt: TIME });
  const report = await run(state);
  expect(report.status).toBe('inconclusive');
  expect(report.evidence.some(entry => entry.path === '/lines?lang=ro')).toBe(false);
 });
 it('does not seed malformed or evidence-free audit rows', async () => {
  const state = setup(); state.audit.evidence = [];
  const report = await run(state);
  expect(report.services).toEqual([]);
  expect(report.status).toBe('inconclusive');
  expect(report.issues.some(issue => issue.code === 'invalid-seed')).toBe(true);
  expect(state.collector.get).toHaveBeenCalledTimes(1);
 });
});
