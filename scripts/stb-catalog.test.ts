import { describe, expect, it } from 'vitest';
import { buildStbCatalog } from './stb-catalog.ts';
import type { StationCatalog } from './station-catalog.ts';
import type { TopologySnapshot } from './catalog-collection.ts';
import { stationServesLine, validateStations } from '../src/lib/stations/membership.ts';
import { findStationsInBounds } from '../src/lib/stations/geo.ts';

const base: StationCatalog = {
	feedVersion: '6.39', sourceUpdatedAt: '2026-09-09T00:00:00Z',
	stations: [
		{ id: 6084, name: 'Isovolta', description: '', lat: 44.4, lon: 26.1, lines: ['BUS:103', 'BUS:N109'] },
		{ id: 7000, name: 'Old stop', description: '', lat: 44.4, lon: 26.1, lines: ['BUS:N109', 'BUS:103'] }
	]
};

function snapshot(): TopologySnapshot {
	return {
		schemaVersion: 1, status: 'complete', source: 'fixture',
		startedAt: '2026-09-25T06:00:00Z', completedAt: '2026-09-25T06:01:00Z',
		registry: [{ id: 199, name: 'N109', type: 'BUS', rawType: 'BUS' }],
		lines: [{ id: 199, allStopIds: [6084, 6165], directions: { 0: [6084], 1: [6165] } }],
		stops: [
			{ id: 6084, name: 'Isovolta', lat: 44.45, lon: 26.2 },
			{ id: 6165, name: 'Isovolta opposite', lat: 44.46, lon: 26.2 }
		], evidence: [], issues: []
	};
}

describe('STB catalog composition', () => {
	it('uses upstream identity, both directions and coordinates; retains only supplemental GTFS memberships', () => {
		const catalog = buildStbCatalog(base, snapshot());
		const source = new Set(catalog.stb.lineIds);
		const old = catalog.stations.find((stop) => stop.id === 7000)!;
		expect(old.lines).toEqual(['BUS:103']);
		expect(old.membershipSource).toBe('gtfs');
		expect(stationServesLine(old, { lineId: 199, lineName: 'N109', vehicleType: 'BUS' }, source)).toBe(false);
		for (const id of [6084, 6165]) {
			const station = catalog.stations.find((stop) => stop.id === id)!;
			expect(stationServesLine(station, { lineId: 199, lineName: 'Renamed', vehicleType: 'UNKNOWN' }, source)).toBe(true);
			expect(station.apiStopIds).toEqual([id]);
		}
		expect(catalog.stations.find((stop) => stop.id === 6084)).toMatchObject({ lat: 44.45, membershipSource: 'mixed' });
		expect(base.stations[0].lat).toBe(44.4);
	});

	it('does not reintroduce a known upstream edge via a stale legacy name', () => {
		const station = { ...base.stations[0], fallbackLines: ['BUS:103'], lineIds: [] };
		expect(stationServesLine(station, { lineId: 199, lineName: 'N109', vehicleType: 'BUS' }, new Set([199]))).toBe(false);
		expect(stationServesLine(station, { lineId: 5, lineName: '103', vehicleType: 'BUS' }, new Set([199]))).toBe(true);
	});

	it('maps shared metro platforms to every existing physical marker without overwriting parent coordinates', () => {
		const data = snapshot();
		data.registry = [{ id: 300, name: 'M1', type: 'SUBWAY', rawType: 'SUBWAY' }];
		data.lines = [{ id: 300, allStopIds: [9653, 9654], directions: { 0: [9653], 1: [9654] } }];
		data.stops = [9653, 9654].map((id) => ({ id, name: 'Dristor', lat: 44.43, lon: 26.15 }));
		const metroBase = { ...base, stations: [14697, 14713].map((id) => ({ ...base.stations[0], id, name: 'Dristor', lines: ['SUBWAY:M1'] })) };
		const catalog = buildStbCatalog(metroBase, data);
		expect(catalog.stations).toHaveLength(2);
		for (const marker of catalog.stations) {
			expect(marker.lineIds).toEqual([300]);
			expect(marker.apiStopIds).toEqual([9653, 9654]);
			expect(marker.lat).toBe(44.4);
		}
	});

	it('represents a new unmapped subway platform by its real source ID', () => {
		const data = snapshot();
		data.registry = [{ id: 300, name: 'M1', type: 'SUBWAY', rawType: 'SUBWAY' }];
		data.lines = [{ id: 300, allStopIds: [9990, 9991], directions: { 0: [9990], 1: [9991] } }];
		data.stops = [9990, 9991].map((id) => ({ id, name: 'New platform', lat: 44.43, lon: 26.15 }));
		const catalog = buildStbCatalog(base, data);
		expect(catalog.stations.find((stop) => stop.id === 9990)).toMatchObject({ apiStopIds: [9990], membershipSource: 'stb' });
	});

	it('preserves every source edge through runtime validation and the dense map filter, including regional termini', () => {
		const data = snapshot();
		data.registry = [{ id: 66, name: '66', type: 'TROLLEYBUS', rawType: 'CABLE_CAR' }];
		data.stops = Array.from({ length: 130 }, (_, index) => ({ id: 20000 + index, name: `Stop ${index}`, lat: index === 129 ? 44.9 : 44.42, lon: 26.1 }));
		data.lines = [{ id: 66, allStopIds: data.stops.map((stop) => stop.id), directions: {
			0: data.stops.slice(0, 65).map((stop) => stop.id), 1: data.stops.slice(65).map((stop) => stop.id)
		} }];
		const catalog = buildStbCatalog(base, data);
		const loaded = validateStations(catalog.stations);
		const known = new Set(catalog.stb.lineIds);
		for (const line of data.lines) {
			const selection = { lineId: line.id, lineName: '66', vehicleType: 'CABLE_CAR' };
			const priority = new Set(loaded.filter((stop) => stationServesLine(stop, selection, known)).map((stop) => stop.id));
			const visible = new Set(findStationsInBounds({ south: 44, north: 45, west: 25, east: 27 }, loaded, 100, null, priority).map((stop) => stop.id));
			for (const direction of [0, 1] as const) {
				for (const id of line.directions[direction]) expect(visible.has(id), `${line.id}/${direction}/${id}`).toBe(true);
			}
			expect(visible.size).toBe(130);
		}
	});

	it('is deterministic and does not hash observation timestamps', () => {
		const first = snapshot();
		const second = snapshot();
		second.completedAt = '2026-09-26T06:01:00Z';
		second.stops.reverse(); second.lines[0].allStopIds.reverse();
		expect(buildStbCatalog(base, first).stb.contentHash).toBe(buildStbCatalog(base, second).stb.contentHash);
	});

	it.each(['partial', 'unknown type', 'orphan stop', 'missing direction', 'inconsistent union', 'missing line', 'coordinate', 'duplicate stop'])(
		'rejects invalid candidate: %s', (failure) => {
			const data = snapshot();
			if (failure === 'partial') data.status = 'inconclusive';
			if (failure === 'unknown type') data.registry[0].rawType = 'HOVERCRAFT';
			if (failure === 'orphan stop') data.stops.pop();
			if (failure === 'missing direction') data.lines[0].directions[1] = [];
			if (failure === 'inconsistent union') data.lines[0].allStopIds.pop();
			if (failure === 'missing line') data.lines = [];
			if (failure === 'coordinate') data.stops[0].lat = 999;
			if (failure === 'duplicate stop') data.stops.push(data.stops[0]);
			expect(() => buildStbCatalog(base, data)).toThrow('STB catalog:');
		}
	);

	it('rejects reuse of previously composed data and metro identity collisions', () => {
		expect(() => buildStbCatalog(buildStbCatalog(base, snapshot()), snapshot())).toThrow('fresh GTFS');
		const data = snapshot();
		data.stops[0].id = 14697;
		data.lines[0].directions[0] = [14697];
		data.lines[0].allStopIds = [14697, 6165];
		expect(() => buildStbCatalog(base, data)).toThrow('collides with metro parent');
	});
});

it('never aliases an unregistered STB ID to a known service with the same name', () => {
	const catalog = buildStbCatalog(base, snapshot());
	const station = catalog.stations.find(stop => stop.id === 6084)!;
	const known = new Set(catalog.stb.lineIds);
	expect(station.lines).toContain('BUS:N109');
	expect(station.fallbackLines).not.toContain('BUS:N109');
	expect(stationServesLine(station, {lineId: 999, lineName: 'N109', vehicleType: 'BUS'}, known)).toBe(false);
	expect(stationServesLine(station, {lineId: 5, lineName: '103', vehicleType: 'BUS'}, known)).toBe(true);
});
