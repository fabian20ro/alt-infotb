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
		const results = searchStations('Is a description', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('A');
	});

	it('respects maxResults', () => {
		const results = searchStations('Piata', stations, 2);
		expect(results).toHaveLength(2);
	});

	it('respects maxResults with 1', () => {
		const results = searchStations('Piata', stations, 1);
		expect(results).toHaveLength(1);
	});

	it('finds matches with split words (new functionality)', () => {
		// "Uni" and "Hub" are present in Piata Unirii / Central hub
		const results = searchStations('Uni Hub', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('handles acronyms correctly', () => {
		const stationsWithAcronym = [
			{ id: 4, name: 'C.F.R. Station', description: 'Acronym test', lat: 0, lon: 0 }
		] as Station[];
		const results = searchStations('cfr', stationsWithAcronym);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('C.F.R. Station');
	});
});
