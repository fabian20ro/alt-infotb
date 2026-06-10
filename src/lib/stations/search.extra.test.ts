import { describe, it, expect } from 'vitest';
import { normalize, searchStations } from './search.js';
import type { Station } from './types.js';

describe('searchStations', () => {
	const stations: Station[] = [
		{ id: 1, name: 'A', description: 'This is a description', lat: 0, lon: 0 },
		{ id: 2, name: 'Piata Unirii', description: 'Central hub', lat: 44, lon: 26 },
		{ id: 3, name: 'Piata Romana', description: 'Another hub', lat: 44, lon: 26 },
	];

	it('finds matches where query is in description', () => {
		const results = searchStations('description', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('A');
	});

	it('finds matches where query is in description with low score', () => {
		const results = searchStations('description', stations);
		// Based on search.ts: description match score is 20
		// normalizedName match score is 100
		// If we search something that only matches description:
		const results2 = searchStations('Is a description', stations);
		expect(results2).toHaveLength(1);
	});

	it('respects maxResults', () => {
		const results = searchStations('Piata', stations, 2);
		expect(results).toHaveLength(2);
	});

	it('respects maxResults with 1', () => {
		const results = searchStations('Piata', stations, 1);
		expect(results).toHaveLength(1);
	});
});
