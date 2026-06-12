import { describe, it, expect } from 'vitest';
import { distanceMeters, findNearestStations, findStationsInBounds } from './geo.js';
import type { Station } from './types.js';

describe('distanceMeters', () => {
	it('calculates distance between two points', () => {
		// Roughly 1113 meters for 0.01 degree
		const d = distanceMeters(44.4, 26.1, 44.41, 26.1);
		expect(d).toBeGreaterThan(1100);
		expect(d).toBeLessThan(1200);
	});
});

describe('findNearestStations', () => {
	const stations: Station[] = [
		{ id: 1, name: 'A', description: '', lat: 44.0, lon: 26.0 },
		{ id: 2, name: 'B', description: '', lat: 44.1, lon: 26.1 },
		{ id: 3, name: 'C', description: '', lat: 44.2, lon: 26.2 },
	];

	it('returns requested number of stations', () => {
		const nearest = findNearestStations(44.05, 26.05, stations, 2);
		expect(nearest).toHaveLength(2);
	});

	it('finds multiple nearest stations within a radius', () => {
		const stations: Station[] = [
			{ id: 1, name: 'A', description: '', lat: 44.0, lon: 26.0 },
			{ id: 2, name: 'B', description: '', lat: 44.05, lon: 26.05 },
			{ id: 3, name: 'C', description: '', lat: 44.1, lon: 26.1 },
		];
		const nearest = findNearestStations(44.02, 26.02, stations, 2);
		expect(nearest).toHaveLength(2);
		expect(nearest[0].id).toBe(1);
		expect(nearest[1].id).toBe(2);
	});
});

describe('findStationsInBounds', () => {
	const stations: Station[] = [
		{ id: 1, name: 'A', description: '', lat: 10, lon: 10 },
		{ id: 2, name: 'B', description: '', lat: 11, lon: 11 },
		{ id: 3, name: 'C', description: '', lat: 12, lon: 12 },
	];

	it('returns stations within bounds', () => {
		const bounds = { south: 9, north: 11.5, west: 9, east: 11.5 };
		const result = findStationsInBounds(bounds, stations, 10);
		expect(result).toHaveLength(2);
	});

	it('returns empty if maxCount is exceeded and no selectedId', () => {
		const bounds = { south: 9, north: 13, west: 9, east: 13 };
		const result = findStationsInBounds(bounds, stations, 1);
		expect(result).toEqual([]);
	});

	it('returns selected station even if out of bounds if selectedId is provided', () => {
		const bounds = { south: 9, north: 11.5, west: 9, east: 11.5 };
		const result = findStationsInBounds(bounds, stations, 1, 3);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe(3);
	});
});
