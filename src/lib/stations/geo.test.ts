import { describe, it, expect } from 'vitest';
import { distanceMeters, findNearestStations, findStationsInBounds } from './geo.js';
import type { Station } from './types.js';

describe('geo', () => {
	describe('distanceMeters', () => {
		it('calculates distance correctly for a known distance', () => {
			// Roughly 136m difference for 0.001 deg delta
			const d = distanceMeters(44.4, 26.1, 44.401, 26.101);
			expect(d).toBeGreaterThan(100);
			expect(d).toBeLessThan(200);
		});

		it('returns 0 for the same location', () => {
			expect(distanceMeters(44.4, 26.1, 44.4, 26.1)).toBe(0);
		});
	});

	describe('findNearestStations', () => {
		const stations: Station[] = [
			{ id: 1, name: 'S1', description: '', lat: 44.4, lon: 26.1 },
			{ id: 2, name: 'S2', description: '', lat: 44.401, lon: 26.1 },
			{ id: 3, name: 'S3', description: '', lat: 44.4, lon: 26.101 },
			{ id: 4, name: 'S4', description: '', lat: 44.5, lon: 26.2 },
		];

		it('finds the nearest station', () => {
			const nearest = findNearestStations(44.4, 26.1, stations, 1);
			expect(nearest[0].id).toBe(1);
		});

		it('respects the count parameter', () => {
			const nearest = findNearestStations(44.4, 26.1, stations, 2);
			expect(nearest).toHaveLength(2);
		});

		it('handles count greater than station count', () => {
			const nearest = findNearestStations(44.4, 26.1, stations, 10);
			expect(nearest).toHaveLength(4);
		});

		it('handles count=0', () => {
			const nearest = findNearestStations(44.4, 26.1, stations, 0);
			expect(nearest).toHaveLength(0);
		});
	});

	describe('findStationsInBounds', () => {
		const stations: Station[] = [
			{ id: 1, name: 'S1', description: '', lat: 44.4, lon: 26.1 },
			{ id: 2, name: 'S2', description: '', lat: 44.5, lon: 26.2 },
			{ id: 3, name: 'S3', description: '', lat: 44.4, lon: 26.2 },
		];

		it('finds stations within bounds', () => {
			const bounds = { south: 44.3, north: 44.6, west: 26.0, east: 26.3 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results).toHaveLength(3);
		});

		it('returns empty if maxCount is exceeded', () => {
			const bounds = { south: 44.3, north: 44.6, west: 26.0, east: 26.3 };
			const results = findStationsInBounds(bounds, stations, 2);
			expect(results).toHaveLength(0);
		});

		it('returns all stations within bounds when selectedId is null', () => {
			const bounds = { south: 44.3, north: 44.6, west: 26.0, east: 26.3 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results).toHaveLength(3);
		});

		it('returns selected station even if not in bounds', () => {
			const bounds = { south: 0, north: 1, west: 0, east: 1 };
			const results = findStationsInBounds(bounds, stations, 10, 1);
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(1);
		});

		it('returns empty if maxCount is 0 and no selectedId', () => {
			const bounds = { south: 44.3, north: 44.6, west: 26.0, east: 26.3 };
			const results = findStationsInBounds(bounds, stations, 0);
			expect(results).toHaveLength(0);
		});

		it('returns selected station if maxCount is 0', () => {
			const bounds = { south: 0, north: 1, west: 0, east: 1 };
			const results = findStationsInBounds(bounds, stations, 0, 1);
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(1);
		});
	});
});
