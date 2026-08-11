import { describe, expect, it } from 'vitest';
import { loadStations, stationCatalogMetadata } from './data.js';

describe('bundled station catalog', () => {
	it('loads a validated TPBI catalog', () => {
		const stations = loadStations();
		expect(stations.length).toBeGreaterThanOrEqual(2_400);
		expect(new Set(stations.map((station) => station.id)).size).toBe(stations.length);
		expect(stations.some((station) => station.id === 3570)).toBe(true);
	});

	it('contains the rebuilt line 5 platform stops', () => {
		const ids = new Set(loadStations().map((station) => station.id));
		for (const id of [12074, 12075, 12095, 12096]) expect(ids.has(id)).toBe(true);
	});

	it('exposes truthful source metadata', () => {
		expect(stationCatalogMetadata.feedVersion).toMatch(/^\d+(?:\.\d+)*$/);
		expect(Number.isNaN(Date.parse(stationCatalogMetadata.sourceUpdatedAt))).toBe(false);
	});

	it('returns a new array on each call so callers cannot corrupt the catalog', () => {
		const first = loadStations();
		const second = loadStations();
		expect(first).not.toBe(second);
		for (const [i, station] of first.entries()) {
			expect(station.id).toBe(second[i].id);
		}
	});

	it('filters stations outside Bucharest coordinate bounds', () => {
		const stations = loadStations();
		for (const station of stations) {
			expect(station.lat).toBeGreaterThanOrEqual(44.2);
			expect(station.lat).toBeLessThanOrEqual(44.7);
			expect(station.lon).toBeGreaterThanOrEqual(25.6);
			expect(station.lon).toBeLessThanOrEqual(26.4);
		}
	});

	it('enforces the Station shape contract on every loaded entry', () => {
		const stations = loadStations();
		for (const station of stations) {
			expect(typeof station.id).toBe('number');
			expect(typeof station.name).toBe('string');
			expect(typeof station.lat).toBe('number');
			expect(typeof station.lon).toBe('number');
			expect(station.id).not.toBeNaN();
			expect(Number.isFinite(station.lat)).toBe(true);
			expect(Number.isFinite(station.lon)).toBe(true);
			expect(station.name.length).toBeGreaterThan(0);
		}
	});

	it('exposes the TPBI source catalog feed version and updated-at timestamp', () => {
		const meta = stationCatalogMetadata;
		expect(meta.feedVersion).toMatch(/^\d+(?:\.\d+)*$/);
		expect(Number.isNaN(Date.parse(meta.sourceUpdatedAt))).toBe(false);
	});
});
