import { describe, it, expect } from 'vitest';
import { distanceMeters, findNearestStations, findStationsInBounds } from './geo.js';
import type { Station } from './types.js';
import type { LatLngBounds } from './geo.js';

describe('distanceMeters', () => {
	it('returns 0 for same point', () => {
		expect(distanceMeters(44.4268, 26.1025, 44.4268, 26.1025)).toBe(0);
	});

	it('calculates known distance: Piata Unirii to Universitate (~1.1km)', () => {
		// Piata Unirii: 44.42658, 26.100225
		// Universitate: 44.43578, 26.10267
		const d = distanceMeters(44.42658, 26.100225, 44.43578, 26.10267);
		expect(d).toBeGreaterThan(900);
		expect(d).toBeLessThan(1300);
	});

	it('calculates known distance: Bucharest to Ploiesti (~55km)', () => {
		const d = distanceMeters(44.4268, 26.1025, 44.9462, 26.0254);
		expect(d).toBeGreaterThan(50_000);
		expect(d).toBeLessThan(65_000);
	});

	it('is symmetric', () => {
		const d1 = distanceMeters(44.4268, 26.1025, 44.9462, 26.0254);
		const d2 = distanceMeters(44.9462, 26.0254, 44.4268, 26.1025);
		expect(Math.abs(d1 - d2)).toBeLessThan(0.01);
	});
});

describe('findNearestStations', () => {
	const stations: Station[] = [
		{ id: 1, name: 'A', description: '', lat: 44.4266, lon: 26.1002 },
		{ id: 2, name: 'B', description: '', lat: 44.4358, lon: 26.1027 },
		{ id: 3, name: 'C', description: '', lat: 44.4500, lon: 26.1100 },
		{ id: 4, name: 'D', description: '', lat: 44.4600, lon: 26.1200 },
		{ id: 5, name: 'E', description: '', lat: 44.5000, lon: 26.1500 },
	];

	it('returns nearest stations sorted by distance', () => {
		const nearest = findNearestStations(44.4268, 26.1025, stations, 3);
		expect(nearest).toHaveLength(3);
		expect(nearest[0].id).toBe(1); // closest
		expect(nearest[1].id).toBe(2);
		expect(nearest[2].id).toBe(3);
	});

	it('includes distance in meters', () => {
		const nearest = findNearestStations(44.4268, 26.1025, stations, 1);
		expect(nearest[0].distanceMeters).toBeGreaterThan(0);
		expect(nearest[0].distanceMeters).toBeLessThan(500);
	});

	it('respects count parameter', () => {
		const nearest = findNearestStations(44.4268, 26.1025, stations, 2);
		expect(nearest).toHaveLength(2);
	});

	it('returns all stations if count exceeds total', () => {
		const nearest = findNearestStations(44.4268, 26.1025, stations, 100);
		expect(nearest).toHaveLength(5);
	});

	it('handles empty station list', () => {
		const nearest = findNearestStations(44.4268, 26.1025, [], 5);
		expect(nearest).toHaveLength(0);
	});
});

describe('findStationsInBounds', () => {
	const stations: Station[] = [
		{ id: 1, name: 'A', description: '', lat: 44.4266, lon: 26.1002 },
		{ id: 2, name: 'B', description: '', lat: 44.4358, lon: 26.1027 },
		{ id: 3, name: 'C', description: '', lat: 44.4500, lon: 26.1100 },
		{ id: 4, name: 'D', description: '', lat: 44.4600, lon: 26.1200 },
		{ id: 5, name: 'E', description: '', lat: 44.5000, lon: 26.1500 },
	];

	const bounds: LatLngBounds = { south: 44.42, north: 44.46, west: 26.09, east: 26.13 };

	it('returns all stations within bounds when under cap', () => {
		const result = findStationsInBounds(bounds, stations, 100);
		// Stations 1, 2, 3 are within bounds; 4 is at 44.46 (boundary); 5 is outside
		expect(result.map((s) => s.id)).toContain(1);
		expect(result.map((s) => s.id)).toContain(2);
		expect(result.map((s) => s.id)).toContain(3);
		expect(result.map((s) => s.id)).not.toContain(5);
	});

	it('returns empty when station count exceeds maxCount (zoomed out too far)', () => {
		const result = findStationsInBounds(bounds, stations, 2);
		expect(result).toHaveLength(0);
	});

	it('returns only selected station when over cap', () => {
		const result = findStationsInBounds(bounds, stations, 2, 1);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(1);
	});

	it('includes selectedId even when outside bounds', () => {
		const result = findStationsInBounds(bounds, stations, 100, 5);
		expect(result.map((s) => s.id)).toContain(5);
	});

	it('returns empty array for bounds with no stations', () => {
		const emptyBounds: LatLngBounds = { south: 45.0, north: 45.1, west: 27.0, east: 27.1 };
		const result = findStationsInBounds(emptyBounds, stations, 100);
		expect(result).toHaveLength(0);
	});

	it('includes station exactly on boundary', () => {
		// Station 4 is at lat 44.46 = north boundary
		const result = findStationsInBounds(bounds, stations, 100);
		expect(result.map((s) => s.id)).toContain(4);
	});
});
