import { describe, expect, it } from 'vitest';
import { inventoryCaptureId, updateServiceInventory, validateServiceInventoryHistory, type InventoryAssessment, type InventoryCapture, type InventoryEvidence, type InventoryObservation } from './service-inventory.ts';

const source = 'https://info.stb.ro/api/web/v2-6';
const a = '2026-09-25T08:00:00.000Z';
const b = '2026-09-26T08:00:00.000Z';
const c = '2026-09-27T08:00:00.000Z';
const baseLine = { id: 796, name: '429', type: 'BUS' as const, rawType: 'BUS' };
function proof(path: string, capturedAt = a): InventoryEvidence { return { path, capturedAt, sha256: 'a'.repeat(64) }; }
function observation(id = 1036, name = 'N700', capturedAt = a, apiStopId = 6084): InventoryObservation {
	return { id, name, rawType: 'BUS', apiStopId, ...proof(`/lines/stop?stop_id=${apiStopId}`, capturedAt) };
}
function capture(completedAt = a, overrides: Partial<Omit<InventoryCapture, 'captureId'>> = {}): InventoryCapture {
	const payload: Omit<InventoryCapture, 'captureId'> = { source, startedAt: completedAt, completedAt, registryStatus: 'complete', registry: [baseLine], registryEvidence: proof('/lines?lang=ro', completedAt), observations: [], topology: [], ...overrides };
	return { ...payload, captureId: inventoryCaptureId(payload) };
}
function rehash(value: InventoryCapture): InventoryCapture {
	const { captureId: _, ...payload } = value;
	return { ...payload, captureId: inventoryCaptureId(payload) };
}

describe('historical service inventory', () => {
	it('records positive identities separately from listing, topology and operating state', () => {
		const result = updateServiceInventory(undefined, capture(a, { observations: [observation()] }));
		expect(result.services).toEqual([
			{ id: 796, firstSeenAt: a, lastSeenAt: a, operationalStatus: 'unknown', registryStatus: 'listed', topologyStatus: 'not-probed', observedAtStops: [], labels: [{ name: '429', rawType: 'BUS', firstSeenAt: a, lastSeenAt: a }] },
			{ id: 1036, firstSeenAt: a, lastSeenAt: a, operationalStatus: 'unknown', registryStatus: 'absent', topologyStatus: 'not-probed', observedAtStops: [6084], labels: [{ name: 'N700', rawType: 'BUS', firstSeenAt: a, lastSeenAt: a }] }
		]);
	});
	it('preserves an event service through absence and reappearance without inferring cancellation', () => {
		const first = updateServiceInventory(undefined, capture(a, { observations: [observation()] }));
		const absent = updateServiceInventory(first, capture(b));
		expect(absent.services.find(item => item.id === 1036)).toMatchObject({ firstSeenAt: a, lastSeenAt: a, operationalStatus: 'unknown', observedAtStops: [] });
		const returned = updateServiceInventory(absent, capture(c, { observations: [observation(1036, 'N700', c, 6165)] }));
		expect(returned.services.find(item => item.id === 1036)).toMatchObject({ firstSeenAt: a, lastSeenAt: c, operationalStatus: 'unknown', observedAtStops: [6165] });
		expect(returned.captures).toHaveLength(3);
		expect(returned.captures[0].observations[0].apiStopId).toBe(6084);
	});
	it('does not infer absence from an incomplete registry', () => {
		const first = updateServiceInventory(undefined, capture());
		const failed = updateServiceInventory(first, capture(b, { registryStatus: 'inconclusive', registry: [], registryEvidence: undefined }));
		expect(failed.services[0]).toMatchObject({ registryStatus: 'unknown', firstSeenAt: a, lastSeenAt: a });
	});
	it('retains positively listed entries in a partially collected registry', () => {
		const result = updateServiceInventory(undefined, capture(a, { registryStatus: 'inconclusive' }));
		expect(result.services[0].registryStatus).toBe('listed');
	});
	it('keeps re-created same-name IDs independent and historic ID present', () => {
		const first = updateServiceInventory(undefined, capture());
		const next = updateServiceInventory(first, capture(b, { registry: [{ ...baseLine, id: 907 }], observations: [observation(796, '429', b)] }));
		expect(next.services.map(item => [item.id, item.registryStatus])).toEqual([[796, 'absent'], [907, 'listed']]);
		expect(next.services[0].operationalStatus).toBe('unknown');
	});
	it('retains label changes without changing upstream identity', () => {
		const first = updateServiceInventory(undefined, capture());
		const next = updateServiceInventory(first, capture(b, { registry: [{ ...baseLine, name: 'R429', rawType: 'TRAM', type: 'TRAM' }] }));
		expect(next.services).toHaveLength(1);
		expect(next.services[0].labels).toEqual([{ name: '429', rawType: 'BUS', firstSeenAt: a, lastSeenAt: a }, { name: 'R429', rawType: 'TRAM', firstSeenAt: b, lastSeenAt: b }]);
	});
	it('keeps unknown transport labels as evidence rather than inventing a bus classification', () => {
		const result = updateServiceInventory(undefined, capture(a, { registryStatus: 'inconclusive', registry: [{ ...baseLine, rawType: 'UNKNOWN', type: undefined }] }));
		expect(result.services[0].labels[0].rawType).toBe('UNKNOWN');
	});
	it('does not advance lastSeen when a later run reuses cached positive responses', () => {
		const first = updateServiceInventory(undefined, capture(a, { observations: [observation()] }));
		const next = updateServiceInventory(first, capture(b, { startedAt: a, registryEvidence: proof('/lines?lang=ro', a), observations: [observation()] }));
		expect(next.services.every(item => item.firstSeenAt === a && item.lastSeenAt === a)).toBe(true);
	});
	it('can discover older positive evidence without replacing the newest observation', () => {
		const first = updateServiceInventory(undefined, capture(b));
		const next = updateServiceInventory(first, capture(c, { startedAt: a, registryEvidence: proof('/lines?lang=ro', a) }));
		expect(next.services[0]).toMatchObject({ firstSeenAt: a, lastSeenAt: b });
		expect(next.services[0].labels[0]).toMatchObject({ firstSeenAt: a, lastSeenAt: b });
	});
	it('tracks topology availability without letting yesterday’s successful probe imply current availability', () => {
		const verified = { id: 796, status: 'verified' as const, issues: [], evidence: ['', '/direction/0', '/direction/1'].map(suffix => proof(`/lines/796${suffix}?lang=ro`)) };
		const first = updateServiceInventory(undefined, capture(a, { topology: [verified] }));
		expect(first.services[0].topologyStatus).toBe('verified');
		const unresolved = updateServiceInventory(first, capture(b, { topology: [{ id: 796, status: 'unresolved', issues: [{ code: 'empty', path: '/lines/796?lang=ro', message: 'Empty response' }], evidence: [] }] }));
		expect(unresolved.services[0].topologyStatus).toBe('unresolved');
		expect(updateServiceInventory(unresolved, capture(c)).services[0].topologyStatus).toBe('not-probed');
	});
	it('replays the same capture idempotently, including an older already-recorded capture', () => {
		const original = capture();
		const first = updateServiceInventory(undefined, original);
		const second = updateServiceInventory(first, capture(b));
		expect(updateServiceInventory(second, original)).toEqual(second);
		expect(updateServiceInventory(first, original)).not.toBe(first);
	});
	it('does not mutate or retain references to either input', () => {
		const input = capture(a, { observations: [observation()] });
		const original = structuredClone(input);
		const result = updateServiceInventory(undefined, input);
		input.observations[0].name = 'modified';
		expect(result.captures[0]).toEqual(original);
		const second = updateServiceInventory(result, capture(b));
		second.services[0].labels[0].name = 'modified';
		expect(result.services[0].labels[0].name).toBe('429');
	});
	it('hashes property order consistently and binds all capture payload fields', () => {
		const input = capture();
		const { captureId, ...payload } = input;
		expect(inventoryCaptureId({ ...payload, registry: [{ rawType: 'BUS', name: '429', id: 796, type: 'BUS' }] })).toBe(captureId);
		expect(inventoryCaptureId({ ...payload, completedAt: b })).not.toBe(captureId);
	});
	it('sorts service IDs and deduplicates current positive stop observations', () => {
		const result = updateServiceInventory(undefined, capture(a, { observations: [observation(1036, 'N700', a, 6165), observation(), observation(), observation(907, '429')] }));
		expect(result.services.map(item => item.id)).toEqual([796, 907, 1036]);
		expect(result.services.at(-1)!.observedAtStops).toEqual([6084, 6165]);
	});
});

describe('inventory input and persisted-history validation', () => {
	it.each([
		['capture hash mismatch', (value: InventoryCapture) => ({ ...value, completedAt: b })],
		['reversed capture interval', (value: InventoryCapture) => rehash({ ...value, startedAt: b })],
		['registry requires timestamped evidence', (value: InventoryCapture) => rehash({ ...value, registryEvidence: undefined })],
		['complete registry cannot be empty', (value: InventoryCapture) => rehash({ ...value, registry: [] })],
		['duplicate registry ID', (value: InventoryCapture) => rehash({ ...value, registry: [baseLine, baseLine] })],
		['inconsistent registry type', (value: InventoryCapture) => rehash({ ...value, registry: [{ ...baseLine, type: 'TRAM' }] })],
		['evidence outside capture interval', (value: InventoryCapture) => rehash({ ...value, observations: [observation(1036, 'N700', b)] })],
		['stop observation endpoint differs', (value: InventoryCapture) => rehash({ ...value, observations: [{ ...observation(), apiStopId: 1 }] })],
		['service observation endpoint differs', (value: InventoryCapture) => rehash({ ...value, observations: [{ ...observation(), apiStopId: undefined }] })],
		['invalid service/stop ID', (value: InventoryCapture) => rehash({ ...value, observations: [observation(0)] })],
		['invalid response evidence', (value: InventoryCapture) => rehash({ ...value, observations: [{ ...observation(), sha256: 'wrong' }] })],
		['topology lacks positive identity observation', (value: InventoryCapture) => rehash({ ...value, topology: [{ id: 1036, status: 'unresolved', issues: [], evidence: [] }] })],
		['verified topology requires three clean endpoint observations', (value: InventoryCapture) => rehash({ ...value, topology: [{ id: 796, status: 'verified', issues: [], evidence: [proof('/lines/796?lang=ro')] }] })],
		['invalid upstream source', (value: InventoryCapture) => rehash({ ...value, source: 'https://user:password@example.org' })]
	] as const)('rejects %s', (message, transform) => {
		expect(() => updateServiceInventory(undefined, transform(capture()))).toThrow(message);
	});
	it('rejects source changes even if the capture is otherwise valid', () => {
		const previous = updateServiceInventory(undefined, capture());
		expect(() => updateServiceInventory(previous, capture(b, { source: 'https://another-provider.example/api' }))).toThrow('upstream source changed');
	});
	it('rejects a new older capture and a conflicting capture at the same completion time', () => {
		const previous = updateServiceInventory(undefined, capture(b));
		expect(() => updateServiceInventory(previous, capture())).toThrow('not chronological');
		expect(() => updateServiceInventory(previous, capture(b, { observations: [observation(1036, 'N700', b)] }))).toThrow('not chronological');
	});
	it('validates persisted summaries before accepting an otherwise idempotent replay', () => {
		const input = capture();
		const previous = updateServiceInventory(undefined, input);
		previous.services[0].lastSeenAt = c;
		expect(() => updateServiceInventory(previous, input)).toThrow('summaries differ');
	});
	it('rejects duplicate, tampered, reordered or cross-source persisted captures', () => {
		const first = updateServiceInventory(undefined, capture());
		const valid = updateServiceInventory(first, capture(b));
		const duplicate = structuredClone(valid); duplicate.captures.push(valid.captures[0]);
		expect(() => validateServiceInventoryHistory(duplicate)).toThrow('duplicate persisted capture');
		const tampered = structuredClone(valid); tampered.captures[0].registry[0].name = 'other';
		expect(() => validateServiceInventoryHistory(tampered)).toThrow('hash mismatch');
		const reordered = structuredClone(valid); reordered.captures.reverse();
		expect(() => validateServiceInventoryHistory(reordered)).toThrow('not chronological');
		const wrongSource = structuredClone(valid); wrongSource.source = 'https://wrong.example';
		expect(() => validateServiceInventoryHistory(wrongSource)).toThrow('upstream source changed');
	});
	it.each([null, {}, { schemaVersion: 2 }, { schemaVersion: 1, captures: [], services: [] }])('rejects malformed persisted inventory %j', value => {
		expect(() => validateServiceInventoryHistory(value)).toThrow('invalid inventory structure');
	});
	it('returns an independent validated history from a JSON boundary', () => {
		const valid = updateServiceInventory(undefined, capture());
		const parsed = validateServiceInventoryHistory(JSON.parse(JSON.stringify(valid)));
		expect(parsed).toEqual(valid);
		expect(parsed).not.toBe(valid);
	});
});

describe('persisted acquisition scope and coverage', () => {
	const registry: InventoryAssessment = { scope: 'registry-only', snapshotHash: 'a'.repeat(64) };
	const full: InventoryAssessment = { scope: 'registry-and-stops', snapshotHash: 'a'.repeat(64), auditHash: 'b'.repeat(64), auditStatus: 'inconclusive', knownStops: 3980, requestedStops: 3, discoveryHash: 'c'.repeat(64), discoveryStatus: 'inconclusive' };
	it('distinguishes registry-only observation from a failed full scan with no positive memberships', () => {
		const registryRun = capture(a, { assessment: registry });
		const fullRun = capture(b, { assessment: full });
		const history = updateServiceInventory(updateServiceInventory(undefined, registryRun), fullRun);
		expect(history.captures.map(item => item.assessment)).toEqual([registry, full]);
		expect(history.services[0].observedAtStops).toEqual([]);
		expect(history.services[0].operationalStatus).toBe('unknown');
	});
	it('accepts a stop audit without a discovery pass and a zero-sized inconclusive audit', () => {
		const assessment = { ...full, discoveryHash: undefined, discoveryStatus: undefined, knownStops: 0, requestedStops: 0 };
		expect(() => updateServiceInventory(undefined, capture(a, { assessment }))).not.toThrow();
	});
	it.each([
		['invalid capture assessment', { ...registry, snapshotHash: 'bad' }],
		['registry-only assessment contains stop audit fields', { ...registry, requestedStops: 0 }],
		['registry-only assessment contains stop audit fields', { ...registry, discoveryHash: 'c'.repeat(64) }],
		['stop assessment requires audit identity and status', { ...full, auditHash: undefined }],
		['stop assessment requires audit identity and status', { ...full, auditStatus: undefined }],
		['invalid stop assessment coverage', { ...full, knownStops: undefined }],
		['invalid stop assessment coverage', { ...full, requestedStops: -1 }],
		['invalid stop assessment coverage', { ...full, requestedStops: 3981 }],
		['invalid stop assessment coverage', { ...full, requestedStops: 1.5 }],
		['discovery assessment requires identity and status', { ...full, discoveryHash: undefined }],
		['discovery assessment requires identity and status', { ...full, discoveryStatus: undefined }],
		['discovery assessment requires identity and status', { ...full, discoveryHash: 'bad' }]
	] as const)('rejects inconsistent assessment: %s', (message, assessment) => {
		expect(() => updateServiceInventory(undefined, capture(a, { assessment }))).toThrow(message);
	});
	it('binds coverage to the capture hash', () => {
		const input = capture(a, { assessment: full });
		input.assessment!.requestedStops = input.assessment!.requestedStops! + 1;
		expect(() => updateServiceInventory(undefined, input)).toThrow('capture hash mismatch');
	});
});
