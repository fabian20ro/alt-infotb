import { describe, it, expect } from 'vitest';
import { distanceMeters, findNearestStations } from './geo.js';
import type { Station } from './types.js';

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
