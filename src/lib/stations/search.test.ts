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

	it('returns empty array for null query', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
		];
		expect(searchStations(null as any, stations)).toEqual([]);
	});

	it('returns empty array for undefined query', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
		];
		expect(searchStations(undefined as any, stations)).toEqual([]);
	});

	it('returns empty array for tab/newline whitespace-only query on searchStations with data', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
			{ id: 2, name: 'Beta', description: 'data', lat: 0, lon: 0 },
		];
		expect(searchStations('   \t\n  ', stations)).toEqual([]);
	});

	it('does not throw on non-string query types', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
		];
		expect(() => searchStations(42 as any, stations)).not.toThrow();
		expect(searchStations(42 as any, stations)).toEqual([]);
	});

	it('does not throw on non-array station list', () => {
		expect(() => searchStations('test', null as any)).not.toThrow();
		expect(searchStations('test', null as any)).toEqual([]);
	});

	it('returns empty array for empty stations list', () => {
		expect(searchStations('anything', [])).toEqual([]);
	});

	it('ranks exact match above word-boundary/all-words and description-only matches', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Bun test query', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'XYZ Info', description: 'Has Bun test query text', lat: 0, lon: 0 },
			{ id: 3, name: 'Bun something Query test here', description: '', lat: 0, lon: 0 },
		];
		const results = searchStations('bun test query', stations);
		expect(results.map(s => s.id)).toEqual([1, 3, 2]);
	});

	it('ranks starts-with above word-boundary match when both exist', () => {
		const stations: Station[] = [
			{ id: 10, name: 'StartWithMe extra stuff', description: '', lat: 0, lon: 0 },
			{ id: 11, name: 'Random StartWithMe word', description: '', lat: 0, lon: 0 },
		];
		const results = searchStations('startwithme', stations);
		expect(results.map(s => s.id)).toEqual([10, 11]);
	});

	it('ranks all-word match above description-only when both exist for a multi-word query', () => {
		const stations: Station[] = [
			{ id: 20, name: 'Hello World', description: '', lat: 0, lon: 0 },
			{ id: 21, name: 'No match here', description: 'Hello World content', lat: 0, lon: 0 },
		];
		const results = searchStations('hello world', stations);
		expect(results.map(s => s.id)).toEqual([20, 21]);
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

	it('strips decomposed combining diacritic marks (e.g., base + U+0326)', () => {
		// Unicode normalization NFD converts pre-combined to base + combining mark;
		// the regex then strips the combining mark entirely.
		// 'S' + combining dot below (U+0326) → after NFD: 'S̥' which is treated as a new char and stripped, yielding 'stion'.
		expect(normalize('S\u0326tion')).toBe('stion');
	});

	it('returns empty array for whitespace-only query', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
		];
		expect(searchStations('   ', stations)).toEqual([]);
	});

	it('returns empty array for punctuation-only query', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
		];
		expect(searchStations('...!!!', stations)).toEqual([]);
	});

	it('strips decomposed diacritics and still finds matches by name', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Piata Unirii', description: 'Hub', lat: 0, lon: 0 },
		];
		// Query with decomposed diacritic on 't': t + combining caron
		const results = searchStations('Pia\u030Cta', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('strips decomposed diacritics and still finds matches via description', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'Cafenea cu cozonac', lat: 0, lon: 0 },
		];
		// Query with decomposed diacritic on 'a': a + combining acute (U+0301) which is in [U+0300-U+036F] range stripped by normalize
		const results = searchStations('cozo\u0301nac', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Alpha');
	});
});
