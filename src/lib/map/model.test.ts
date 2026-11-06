import { describe, expect, it } from 'vitest';
import { loadStations } from '../stations/data.js';
import { createMapScene, visibleStations, type MapSceneInput } from './model.js';

const city = { south: 44.19, north: 44.80, west: 25.80, east: 26.49 };
const input = (): MapSceneInput => ({ allStations: loadStations(), selectedStationId: null,
	userPosition: null, locationPermission: 'prompt', locationError: null, theme: 'dark', route: null });

describe('renderer-independent transit scene', () => {
	it('keeps all three Isovolta platforms for N109 above the background density cap', () => {
		const scene = createMapScene({ ...input(), route: {
			key: '6084:889:0', lineId: 889, lineName: 'N109', vehicleType: 'BUS', primary: null, opposite: null
		} });
		const visible = visibleStations(scene, city);
		expect(scene.allStations.length).toBeGreaterThan(100);
		for (const id of [6084, 6165, 7267]) {
			expect(scene.routeStationIds.has(id)).toBe(true);
			expect(visible.find(station => station.id === id)?.name).toBe('Isovolta');
		}
		expect(visible.some(station => !scene.routeStationIds.has(station.id))).toBe(false);
	});

	it('uses STB identity for both directions even if a line label changes', () => {
		const scene = createMapScene({ ...input(), route: {
			key: '66', lineId: 72, lineName: 'Renamed', vehicleType: 'CABLE_CAR', primary: null, opposite: null
		} });
		expect(scene.routeStationIds.has(3675)).toBe(true); // Vasile Parvan
		expect(scene.routeStationIds.has(3684)).toBe(true); // Bucur Obor
		expect(scene.routeStationIds.has(6084)).toBe(false); // Isovolta is not on 66
		const ids = visibleStations(scene, city).map(station => station.id);
		expect(ids).toContain(3675); expect(ids).toContain(3684);
	});

	it('retains a selected off-screen stop once and never clips transit to the offline package bounds', () => {
		const selected = { id: 20000, name: 'Beyond the package', description: '', lat: 44.85, lon: 26.55 };
		const scene = createMapScene({ ...input(), allStations: [...loadStations(), selected], selectedStationId: selected.id });
		expect(visibleStations(scene, city)).toEqual([selected]);
		const outside = { south: 44.84, north: 44.86, west: 26.54, east: 26.56 };
		expect(visibleStations(scene, outside).filter(station => station.id === selected.id)).toEqual([selected]);
	});

	it('does not retain previous line membership after clearing or changing the route', () => {
		const first = createMapScene({ ...input(), route: {
			key: 'N109', lineId: 889, lineName: 'N109', vehicleType: 'BUS', primary: null, opposite: null
		} });
		const cleared = createMapScene({ ...first, route: null });
		expect(cleared.routeStationIds.size).toBe(0);
		expect(visibleStations(cleared, city)).toEqual([]);
		expect(first.routeStationIds.has(6084)).toBe(true);
	});
});
