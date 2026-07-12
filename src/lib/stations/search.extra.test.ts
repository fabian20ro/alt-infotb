import { describe, it, expect } from 'vitest';
import { normalize, searchStations } from './search.js';
import type { Station } from './types.js';

describe('normalize', () => {
	it('strips diacritics via NFD decomposition and lowercases', () => {
		expect(normalize('Piața Unirii')).toBe('piata unirii');
	});

	it('collapses dotted acronym variants preserving surrounding spaces', () => {
		expect(normalize('cfr progresul')).toBe('cfr progresul');
	});

	it('greedily merges spaced multi-letter acronyms with adjacent words into one token', () => {
		expect(normalize('c f r progresul')).toBe('cfrprogresul');
	});

	it('merges mixed dot/space acronyms and consumes following word as part of the merged token', () => {
		expect(normalize('a. b c. test')).toBe('abctest');
	});

	it('strips punctuation and special characters leaving only alphanumerics and spaces, then lowercases', () => {
		expect(normalize('căile ferate române! @$#')).toBe('caile ferate romane');
	});

	it('lowercases the result', () => {
		expect(normalize('ALPHA BRAVO CHARLIE')).toBe('alpha bravo charlie');
	});
});

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

	it('matches a compound acronym query (acronym + word)', () => {
		const stationsWithCompound = [
			{ id: 4, name: 'CFR Progresul', description: '', lat: 0, lon: 0 },
			{ id: 5, name: 'C.F.R. Progresul', description: '', lat: 0, lon: 0 }
		] as Station[];
		const results = searchStations('cfr progresul', stationsWithCompound);
		expect(results).toHaveLength(2);
	});

	it('collapses extra whitespace in the query before matching', () => {
		const results = searchStations('Piata   Unirii', [{ id: 1, name: 'Piața Unirii', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piața Unirii');
	});

	it('collapses extra whitespace in the station name before matching', () => {
		const paddedStations = [
			{ id: 10, name: 'Piata    Unirii', description: '', lat: 0, lon: 0 }
		] as Station[];
		const results = searchStations('piata unirii', paddedStations);
		expect(results).toHaveLength(1);
	});

	it('returns [] for empty string query', () => {
		const results = searchStations('', [{ id: 1, name: 'A', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toEqual([]);
	});

	it('returns [] for whitespace-only query', () => {
		const results = searchStations('   ', [{ id: 1, name: 'A', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toEqual([]);
	});

	it('treats dashes as spaces — plain query matches dash-separated name', () => {
		const stationsWithDash = [
			{ id: 1, name: 'Piața–Unirii Nord', description: '', lat: 0, lon: 0 }
		] as Station[];
		const results = searchStations('piața unirii nord', stationsWithDash);
		expect(results).toHaveLength(1);
	});

	it('numeric ID query matches by station id', () => {
		const results = searchStations('2', [{ id: 1, name: 'A', description: '', lat: 0, lon: 0 }, { id: 2, name: 'B', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(2);
	});

	it('numeric ID query does not match non-numeric substring of a name', () => {
		const results = searchStations('3570', [{ id: 1, name: 'Piata Unirii', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toEqual([]);
	});

	it('numeric ID query matches only exact ID, not partial substring of a longer number', () => {
		const results = searchStations('2', [
			{ id: 123, name: 'X', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'Y', description: '', lat: 0, lon: 0 }
		] as Station[]);
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(2);
	});

	it('numeric query with trailing whitespace still resolves to the exact ID', () => {
		const results = searchStations('4 ', [
			{ id: 4, name: 'Delta', description: '', lat: 0, lon: 0 },
			{ id: 14, name: 'Fourteen', description: '', lat: 0, lon: 0 }
		] as Station[]);
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(4);
	});

	it('single-word description query returns only the station whose name does not contain it', () => {
		const stations = [
			{ id: 1, name: 'description', description: 'this has no match', lat: 0, lon: 0 },
			{ id: 2, name: 'Alpha', description: 'The word here appears', lat: 0, lon: 0 }
		] as Station[];
		const results = searchStations('here', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Alpha');
	});

	it('higher-scoring matches are returned before lower-scoring ones', () => {
		const stations = [
			{ id: 1, name: 'Piata Unirii', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'Unirii Piata', description: '', lat: 0, lon: 0 }
		] as Station[];
		const results = searchStations('piata unirii', stations);
		expect(results).toHaveLength(2);
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('diacritic-normalized query finds ASCII-named station', () => {
		const results = searchStations('Piața Unirii', [{ id: 1, name: 'Piata Unirii', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toHaveLength(1);
	});

	it('diacritic-named station found by ASCII query', () => {
		const results = searchStations('piata unirii', [{ id: 1, name: 'Piața Unirii', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toHaveLength(1);
	});

	it('returns [] for null stations', () => {
		const results = searchStations('abc', null as unknown as Station[]);
		expect(results).toEqual([]);
	});

	it('returns [] for undefined stations', () => {
		const results = searchStations('abc', undefined as unknown as Station[]);
		expect(results).toEqual([]);
	});

	it('returns [] for null query', () => {
		const results = searchStations(null, [{ id: 1, name: 'A', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toEqual([]);
	});

	it('returns [] for undefined query', () => {
		const results = searchStations(undefined, [{ id: 1, name: 'A', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toEqual([]);
	});

	it('numeric query "0" returns [] when no station has that ID', () => {
		const results = searchStations('0', [{ id: 1, name: 'A', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toEqual([]);
	});

	it('numeric query "02" (leading zero) returns [] when no station has ID 2', () => {
		const results = searchStations('02', [{ id: 1, name: 'A', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toEqual([]);
	});

	it('numeric query "0" does not match station with non-numeric ID prefix', () => {
		const results = searchStations('0', [{ id: 10, name: 'Zeroes', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toEqual([]);
	});

	it('null query does not match any station by ID or name', () => {
		const results = searchStations(null, [{ id: 1, name: 'A', description: '', lat: 0, lon: 0 }] as Station[]);
		expect(results).toEqual([]);
	});

	it('numeric query with leading zeros resolves to parsed integer ID', () => {
		const results = searchStations('02', [
			{ id: 1, name: 'One', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'Two', description: '', lat: 0, lon: 0 }
		] as Station[]);
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(2);
	});
});
