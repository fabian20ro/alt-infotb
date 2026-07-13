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

		it('is symmetric: swapping endpoints yields the same distance', () => {
			const fwd = distanceMeters(44.4, 26.1, 45.0, 27.0);
			const rev = distanceMeters(45.0, 27.0, 44.4, 26.1);
			expect(fwd).toBeCloseTo(rev, 3);
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


		it('does not hide other in-bounds stations when selected station is within bounds', () => {
			const bounds = { south: 44, north: 45, west: 26, east: 27 };
			const results = findStationsInBounds(bounds, stations, 10, 1);
			expect(results.map((s) => s.id)).toEqual([1, 2, 3]);
		});

		it('keeps selected station visible when it is outside bounds', () => {
			const bounds = { south: 44.35, north: 44.45, west: 26.05, east: 26.15 };
			const results = findStationsInBounds(bounds, stations, 10, 2);
			expect(results.map((s) => s.id)).toEqual([2, 1]);
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

		it('falls through to bounds filtering when selectedId does not match any station', () => {
			const bounds = { south: 44.3, north: 44.6, west: 26.0, east: 26.3 };
			const results = findStationsInBounds(bounds, stations, 10, 99);
			expect(results).toHaveLength(3);
		});

		it('returns in-bounds stations when selectedId is outside the station list', () => {
			const wideBounds = { south: 40, north: 50, west: 20, east: 30 };
			const farStations: Station[] = [
				{ id: 100, name: 'F1', description: '', lat: 44.8, lon: 26.5 },
				{ id: 101, name: 'F2', description: '', lat: 45.2, lon: 27.5 },
			];
			const results = findStationsInBounds(wideBounds, farStations, 10, 99);
			expect(results.map((s) => s.id)).toEqual([100, 101]);
		});

		it('returns only the selected station when maxCount is exceeded and selected is in-bounds', () => {
			const bounds = { south: 44.3, north: 44.6, west: 26.0, east: 26.3 };
			const results = findStationsInBounds(bounds, stations, 1, 1);
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(1);
		});

		it('returns empty when maxCount is exceeded and no selected station', () => {
			const bounds = { south: 44.3, north: 44.6, west: 26.0, east: 26.3 };
			const results = findStationsInBounds(bounds, stations, 1);
			expect(results).toHaveLength(0);
		});

		it('does not duplicate the selected station when it falls within bounds', () => {
			const bounds = { south: 44.35, north: 44.45, west: 26.05, east: 26.15 };
			const results = findStationsInBounds(bounds, stations, 10, 1);
			expect(results.map((s) => s.id)).toEqual([1]);
		});

		it('includes a station exactly at the south boundary', () => {
			const bounds = { south: 44.4, north: 44.4001, west: 26, east: 27 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results.map((s) => s.id).sort()).toEqual([1, 3]); // S1 and S3 at lat=44.4
		});

		it('includes a station exactly at the north boundary', () => {
			const bounds = { south: 44.499, north: 44.5, west: 26.2, east: 26.2 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results.map((s) => s.id)).toEqual([2]); // S2 at lat=44.5, lon=26.2
		});

		it('includes a station exactly at the west boundary', () => {
			const bounds = { south: 44.399, north: 44.401, west: 26.1, east: 26.1 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results.map((s) => s.id)).toEqual([1]); // S1 at lat=44.4, lon=26.1
		});

		it('includes a station exactly at the east boundary', () => {
			const bounds = { south: 44.399, north: 44.501, west: 26.2, east: 26.2 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results.map((s) => s.id).sort()).toEqual([2, 3]); // S2 and S3 at lon=26.2
		});

		it('excludes a station just beyond the south boundary', () => {
			const bounds = { south: 44.401, north: 44.6, west: 26, east: 27 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results.map((s) => s.id).sort()).toEqual([2]); // S1 and S3 excluded (lat=44.4 < 44.401), only S2 remains
		});

		it('returns only the selected station when bounds are zero-area at that station', () => {
			const bounds = { south: 44.4, north: 44.4, west: 26.1, east: 26.1 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results.map((s) => s.id)).toEqual([1]); // S1 at exactly (44.4, 26.1)
		});

		it('returns empty when bounds are zero-area and no station matches', () => {
			const bounds = { south: 45, north: 45, west: 27, east: 27 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results).toHaveLength(0);
		});

		it('excludes a station just beyond the north boundary', () => {
			const bounds = { south: 40, north: 44.40001, west: 26, east: 26.15 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results.map((s) => s.id)).toEqual([1]); // S2 excluded (lat=44.5 > 44.40001), S3 excluded (lon=26.2 > 26.15), only S1 remains
		});

		it('returns selected station when no stations fall within bounds', () => {
			const bounds = { south: 48, north: 49, west: 30, east: 31 };
			const results = findStationsInBounds(bounds, stations, 10, 1);
			expect(results.map((s) => s.id)).toEqual([1]); // No in-bounds stations; selectedId=1 should still be returned
		});

		it('returns empty when no stations fall within bounds and no selected station', () => {
			const bounds = { south: 48, north: 49, west: 30, east: 31 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results).toHaveLength(0); // No in-bounds, no selectedId → empty array
		});

		it('returns only the selected station when bounds are zero-area and exclude all stations', () => {
			const bounds = { south: 48, north: 48, west: 30, east: 30 };
			const results = findStationsInBounds(bounds, stations, 10, 2);
			expect(results.map((s) => s.id)).toEqual([2]); // Zero-area bounds at (48,30); selectedId=2 should still be returned
		});

		it('returns empty when zero-area bounds exclude all stations and no selected', () => {
			const bounds = { south: 48, north: 48, west: 30, east: 30 };
			const results = findStationsInBounds(bounds, stations, 10);
			expect(results).toHaveLength(0); // Zero-area bounds with no station and no selectedId → empty
		});

		it('does not return the selected station when it has a negative id', () => {
			const bounds = { south: 48, north: 49, west: 30, east: 31 };
			const results = findStationsInBounds(bounds, stations, 10, -1);
			expect(results).toHaveLength(0); // selectedId=-1 is not a valid station id; no in-bounds → empty
		});
	});
});
