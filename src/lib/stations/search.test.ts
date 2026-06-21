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
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('respects maxResults with 1', () => {
		const results = searchStations('Piata', stations, 1);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piata Unirii');
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

	it('finds station by numeric ID', () => {
		const stations: Station[] = [
			{ id: 1, name: 'S1', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'S2', description: '', lat: 0, lon: 0 },
		];
		expect(searchStations('1', stations)[0].id).toBe(1);
		expect(searchStations('2', stations)[0].id).toBe(2);
	});

	it('matches C.F.R. Station with CFR Station', () => {
		const stationsWithAcronym = [
			{ id: 4, name: 'C.F.R. Station', description: 'Acronym test', lat: 0, lon: 0 }
		] as Station[];
		const results = searchStations('CFR Station', stationsWithAcronym);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('C.F.R. Station');
	});
});

describe('normalize', () => {
	it('removes diacritics', () => {
		expect(normalize('Piata')).toBe('piata');
		expect(normalize('Piățã')).toBe('piata');
	});

	it('handles acronyms with spaces and dots', () => {
		expect(normalize('C. F. R.')).toBe('cfr');
		expect(normalize('C.F.R.')).toBe('cfr');
	});

	it('handles acronyms followed by text without space', () => {
		expect(normalize('C.F.R.Station')).toBe('cfrstation');
	});

	it('treats dashes as spaces', () => {
		expect(normalize('Piata-Unirii')).toBe('piata unirii');
	});

	it('collapses multiple spaces', () => {
		expect(normalize('  Too   Many   Spaces  ')).toBe('too many spaces');
	});
});
