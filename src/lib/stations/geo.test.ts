import { describe, it, expect } from 'vitest';
import { distanceMeters, findNearestStations, findStationsInBounds } from './geo.js';
import type { Station } from './types.js';

describe('geo', () => {
	describe('distanceMeters', () => {
		it('calculates distance correctly for a known distance', () => {
			const d = distanceMeters(44.4, 26.1, 44.401, 26.101);
			expect(d).toBeGreaterThan(100);
			expect(d).toBeLessThan(200);
		});

		it('returns 0 for the same location', () => {
			expect(distanceMeters(44.4, 26.1, 44.4, 26.1)).toBe(0);
		});

		it('handles antipodal points without returning NaN', () => {
			const d = distanceMeters(90, 0, -90, 0);
			expect(d).toBeGreaterThan(0);
			expect(isNaN(d)).toBe(false);
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

		it('handles empty stations array', () => {
			const nearest = findNearestStations(44.4, 26.1, [], 5);
			expect(nearest).toHaveLength(0);
		});

		it('finds stations with larger count and distance', () => {
			const farStations: Station[] = [
				{ id: 10, name: 'F1', description: '', lat: 45.0, lon: 27.0 },
				{ id: 11, name: 'F2', description: '', lat: 45.1, lon: 27.1 },
			];
			const nearest = findNearestStations(44.4, 26.1, farStations, 2);
			expect(nearest).toHaveLength(2);
		});

		it('expands bounding box to find distant stations', () => {
			// Stations at ~5km away — outside the initial ~0.018° (~2 km) radius
			const farStations: Station[] = [
				{ id: 20, name: 'Far1', description: '', lat: 44.46, lon: 26.1 },   // ~6.7 km north
				{ id: 21, name: 'Far2', description: '', lat: 44.5, lon: 26.2 },     // ~10+ km NE
				{ id: 22, name: 'Far3', description: '', lat: 44.42, lon: 26.1 },    // ~2.2 km north
			];
			const nearest = findNearestStations(44.4, 26.1, farStations, 2);

			expect(nearest).toHaveLength(2);
			// Far3 (~2.2km) should come before Far1 (~6.7km) by distance
			expect(nearest[0].id).toBe(22);
			expect(nearest[1].id).toBe(20);
		});

		it('returns stations sorted by actual haversine distance after expansion', () => {
			const farStations: Station[] = [
				{ id: 30, name: 'A', description: '', lat: 44.5, lon: 26.1 },       // ~11 km north
				{ id: 31, name: 'B', description: '', lat: 44.42, lon: 26.101 },     // ~2.2 km NE
				{ id: 32, name: 'C', description: '', lat: 44.45, lon: 26.15 },      // ~5.5 km NE
			];
			const nearest = findNearestStations(44.4, 26.1, farStations, 3);

			expect(nearest).toHaveLength(3);
			// Verify strict distance ordering after expansion + sort
			expect(nearest[0].distanceMeters).toBeLessThan(nearest[1].distanceMeters);
			expect(nearest[1].distanceMeters).toBeLessThan(nearest[2].distanceMeters);
		});

		it('expands bounding box across multiple iterations to reach distant stations', () => {
			// Stations at 0.6° away (~68 km) — requires expansion past several doublings:
			// initial 0.018 < 0.6, then 0.036, 0.072, 0.144 (still too small), 0.288 (no match yet for lon diff),
			// until eventually radius covers the gap. Exercises multi-iteration expansion path.
			const farStations: Station[] = [
				{ id: 50, name: 'Far1', description: '', lat: 45.0, lon: 26.1 },   // ~68 km north
				{ id: 51, name: 'Far2', description: '', lat: 45.0, lon: 26.2 },    // ~76 km NE
			];
			const nearest = findNearestStations(44.4, 26.1, farStations, 3);

			expect(nearest).toHaveLength(2);
			expect(nearest[0].id).toBe(50);
			expect(nearest[1].id).toBe(51);
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


		it('returns selected station if it is within bounds', () => {
			const bounds = { south: 44, north: 45, west: 26, east: 27 };
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
			const bounds = { south: 45, north: 46, west: 26.0, east: 26.3 };
			const results = findStationsInBounds(bounds, stations, 0, 1);
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(1);
		});
	});
});
