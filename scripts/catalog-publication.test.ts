import { describe, expect, it } from 'vitest';
import { buildStbCatalog, type StbStationCatalog } from './stb-catalog.ts';
import { catalogHash, snapshotHash, validatePublication, verifyStbCatalog, type BoundMembershipAudit } from './catalog-publication.ts';
import type { TopologySnapshot } from './catalog-collection.ts';

const now = Date.parse('2026-09-25T09:00:00Z');
const base = { feedVersion: '6.39', sourceUpdatedAt: '2026-09-09T00:00:00Z', stations: [] };

function source(time = '2026-09-25T08:00:00Z'): TopologySnapshot {
	const snapshot: TopologySnapshot = {
		schemaVersion: 1, status: 'complete', source: 'test-proxy', startedAt: time,
		completedAt: new Date(Date.parse(time) + 60_000).toISOString(),
		registry: [{ id: 199, name: 'N109', type: 'BUS', rawType: 'BUS' }],
		lines: [{ id: 199, directions: { 0: [6084, 6165], 1: [7267] }, allStopIds: [6084, 6165, 7267] }],
		stops: [6084, 6165, 7267].map((id) => ({ id, name: `Isovolta ${id}`, lat: 44.8, lon: 26.1 })),
		evidence: [], issues: []
	};
	snapshot.evidence = ['/lines?lang=ro', '/lines/199?lang=ro', '/lines/199/direction/0?lang=ro', '/lines/199/direction/1?lang=ro']
		.map((path) => ({ path, sha256: 'a'.repeat(64), capturedAt: time }));
	return snapshot;
}

function audit(snapshot: TopologySnapshot, catalog: StbStationCatalog): BoundMembershipAudit {
	const time = '2026-09-25T08:20:00Z';
	return {
		schemaVersion: 1, status: 'conform', inventoryScope: 'catalog-and-topology',
		startedAt: time, completedAt: '2026-09-25T08:30:00Z',
		snapshotHash: snapshotHash(snapshot), catalogHash: catalogHash(catalog),
		coverage: { catalogMarkers: catalog.stations.length, verifiedMarkers: catalog.stations.length, unverifiedMarkers: 0, knownApiStops: snapshot.stops.length, requested: snapshot.stops.length, verified: snapshot.stops.length, unverified: 0 },
		unmappedMarkers: [], issues: [], discrepancies: [],
		stops: snapshot.stops.map((stop) => ({ apiStopId: stop.id, markerIds: [stop.id], status: 'verified', name: stop.name, lines: [{ ...snapshot.registry[0], directionId: 0 }], issues: [] })),
		evidence: snapshot.stops.map((stop) => ({ path: `/lines/stop?stop_id=${stop.id}`, sha256: 'b'.repeat(64), capturedAt: time }))
	};
}

function removed(time?: string): TopologySnapshot {
	const snapshot = source(time);
	snapshot.lines[0].directions[0] = [6084];
	snapshot.lines[0].allStopIds = [6084, 7267];
	snapshot.stops = snapshot.stops.filter((stop) => stop.id !== 6165);
	return snapshot;
}

describe('source-to-runtime exhaustive verification', () => {
	it('checks every direction edge through the real density cap and regional coordinate loader', () => {
		const snapshot = source(), catalog = buildStbCatalog(base, snapshot);
		expect(verifyStbCatalog(snapshot, catalog)).toMatchObject({ lines: 1, directions: 2, sourceStops: 3, markers: 3, directionEdges: 3, markerMemberships: 3 });
	});

	it('detects a deliberately removed source edge, not merely a checksum difference', () => {
		const snapshot = source(), catalog = buildStbCatalog(base, snapshot);
		catalog.stations[0].lineIds = [];
		expect(() => verifyStbCatalog(snapshot, catalog)).toThrow('missing rendered edge');
	});

	it('rejects extra edges, a changed enum and invalid coordinates', () => {
		const snapshot = source(), catalog = buildStbCatalog(base, snapshot);
		catalog.stations[0].lineIds!.push(999);
		expect(() => verifyStbCatalog(snapshot, catalog)).toThrow('extra/missing membership');
		const clean = buildStbCatalog(base, snapshot);
		snapshot.registry[0].rawType = 'NEW_TYPE';
		expect(() => verifyStbCatalog(snapshot, clean)).toThrow('invalid line');
		const second = source();
		clean.stations[0].lat = 999;
		expect(() => verifyStbCatalog(second, clean)).toThrow('runtime drops');
	});

	it('rejects lost source directions and altered platform resolution', () => {
		const snapshot = source(), catalog = buildStbCatalog(base, snapshot);
		catalog.stations[0].apiStopIds = [123];
		expect(() => verifyStbCatalog(snapshot, catalog)).toThrow('platform resolution');
		const clean = buildStbCatalog(base, snapshot);
		snapshot.lines[0].directions[1] = [];
		expect(() => verifyStbCatalog(snapshot, clean)).toThrow('direction union');
	});
});

describe('protected catalog publication', () => {
	it('allows a fully audited unchanged source without a second capture', () => {
		const snapshot = source(), catalog = buildStbCatalog(base, snapshot);
		expect(validatePublication(snapshot, snapshot, undefined, audit(snapshot, catalog), catalog, { now })).toEqual({ addedEdges: 0, removedEdges: 0, changedLines: 0 });
	});

	it('requires explicit review for initial migration and bulk changes', () => {
		const snapshot = source(), catalog = buildStbCatalog(base, snapshot), report = audit(snapshot, catalog);
		expect(() => validatePublication(undefined, snapshot, undefined, report, catalog, { now })).toThrow('explicit review');
		expect(validatePublication(undefined, snapshot, undefined, report, catalog, { now, reviewedBulkChange: true }).addedEdges).toBe(3);
	});

	it('requires independent confirmation of deletion, even after explicit bulk review', () => {
		const previous = source('2026-09-24T08:00:00Z'), snapshot = removed(), catalog = buildStbCatalog(base, snapshot), report = audit(snapshot, catalog);
		const options = { now, reviewedBulkChange: true };
		expect(() => validatePublication(previous, snapshot, undefined, report, catalog, options)).toThrow('independent confirmation');
		expect(() => validatePublication(previous, snapshot, snapshot, report, catalog, options)).toThrow('captured after');
		expect(() => validatePublication(previous, snapshot, source('2026-09-25T08:10:00Z'), report, catalog, options)).toThrow('reappeared');
		expect(validatePublication(previous, snapshot, removed('2026-09-25T08:10:00Z'), report, catalog, options).removedEdges).toBe(1);
	});

	it('does not accept old cached responses as an independent deletion confirmation', () => {
		const previous = source('2026-09-24T08:00:00Z'), snapshot = removed(), catalog = buildStbCatalog(base, snapshot);
		const confirmation = removed('2026-09-25T08:10:00Z');
		confirmation.evidence[1].capturedAt = snapshot.startedAt;
		expect(() => validatePublication(previous, snapshot, confirmation, audit(snapshot, catalog), catalog, { now, reviewedBulkChange: true })).toThrow('stale source evidence');
	});

	it('rejects a confirmation mislabeled complete but missing a direction', () => {
		const previous = source('2026-09-24T08:00:00Z'), snapshot = removed(), catalog = buildStbCatalog(base, snapshot);
		const confirmation = removed('2026-09-25T08:10:00Z');
		confirmation.lines[0].directions[1] = [];
		expect(() => validatePublication(previous, snapshot, confirmation, audit(snapshot, catalog), catalog, { now, reviewedBulkChange: true })).toThrow('empty direction');
	});

	it.each(['partial', 'wrong snapshot', 'wrong catalog', 'missing binding', 'stale', 'missing stop', 'missing evidence', 'unknown enum'])(
		'rejects unusable or unrelated full audit: %s', (problem) => {
			const snapshot = source(), catalog = buildStbCatalog(base, snapshot), report = audit(snapshot, catalog);
			if (problem === 'partial') report.status = 'inconclusive';
			if (problem === 'wrong snapshot') report.snapshotHash = 'wrong';
			if (problem === 'wrong catalog') report.catalogHash = 'wrong';
			if (problem === 'missing binding') delete (report as Partial<BoundMembershipAudit>).catalogHash;
			if (problem === 'stale') report.startedAt = '2026-09-24T08:00:00Z';
			if (problem === 'missing stop') report.stops.pop();
			if (problem === 'missing evidence') report.evidence.pop();
			if (problem === 'unknown enum') report.issues.push({ code: 'unknown-type', path: 'stop', message: 'Unexpected type' });
			expect(() => validatePublication(snapshot, snapshot, undefined, report, catalog, { now })).toThrow('Catalog verification:');
		}
	);

	it('rejects stale, missing or future source evidence independently of audit status', () => {
		const snapshot = source(), catalog = buildStbCatalog(base, snapshot);
		snapshot.evidence[0].capturedAt = '2026-09-26T08:00:00Z';
		expect(() => validatePublication(snapshot, snapshot, undefined, audit(snapshot, catalog), catalog, { now })).toThrow('source evidence');
		const old = source('2026-09-24T08:00:00Z'), oldCatalog = buildStbCatalog(base, old);
		expect(() => validatePublication(old, old, undefined, audit(old, oldCatalog), oldCatalog, { now })).toThrow('candidate observation');
	});
});

it('rejects a fresh capture from the previous Romanian transit day at publication', () => {
	const snapshot = source('2026-09-25T00:58:00Z'); // 03:58 local, before the boundary
	const catalog = buildStbCatalog(base, snapshot);
	expect(() => validatePublication(snapshot, snapshot, undefined, audit(snapshot, catalog), catalog, {
		now: Date.parse('2026-09-25T01:01:00Z') // 04:01 local, only three minutes later
	})).toThrow('another transit day');
});

it('does not confuse a proxy transport change with a different upstream source', () => {
	const previous = source(), snapshot = source();
	previous.via = 'local-proxy'; snapshot.via = 'https://new-proxy.example';
	const catalog = buildStbCatalog(base, snapshot);
	expect(validatePublication(previous, snapshot, undefined, audit(snapshot, catalog), catalog, { now })).toMatchObject({addedEdges: 0, removedEdges: 0});
});
