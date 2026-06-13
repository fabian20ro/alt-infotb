import { describe, it, expect } from 'vitest';
import { normalize, searchStations } from './search.js';
import type { Station } from './types.js';

describe('normalize', () => {
	it('strips Romanian diacritics', () => {
		expect(normalize('Piața Unirii')).toBe('piata unirii');
		expect(normalize('Ștefan cel Mare')).toBe('stefan cel mare');
		expect(normalize('Românească')).toBe('romaneasca');
	});

	it('handles mixed case', () => {
		expect(normalize('PIAȚA UNIRII')).toBe('piata unirii');
	});

	it('handles cedilla variants (ş vs ș)', () => {
		expect(normalize('Ştefan')).toBe('stefan');
		expect(normalize('Ţepeş')).toBe('tepes');
	});

	it('handles decomposed Unicode diacritics from pasted text', () => {
		expect(normalize('S\u0326tefan cel Mare')).toBe('stefan cel mare');
		expect(normalize('T\u0326epes\u0326')).toBe('tepes');
		expect(normalize('S\u0327tefan')).toBe('stefan');
		expect(normalize('T\u0327epes')).toBe('tepes');
		expect(normalize('A\u0303urela')).toBe('aurela');
		expect(normalize('A\u0302releia')).toBe('areleia');
	});

	it('preserves non-diacritic characters', () => {
		expect(normalize('abc 123')).toBe('abc 123');
	});

	it('handles acronyms like C.F.R.', () => {
		expect(normalize('C.F.R. Progresul')).toBe('cfr progresul');
		expect(normalize('S.T.E.F.A.N.')).toBe('stefan');
	});

	it('handles punctuation and brackets', () => {
		expect(normalize('Station [Alpha] (Beta)!')).toBe('station alpha beta');
		expect(normalize('{Test} & More')).toBe('test more');
	});

	it('handles complex punctuation and brackets', () => {
		expect(normalize('Station [Alpha] (Beta)!')).toBe('station alpha beta');
		expect(normalize('{Test} & More')).toBe('test more');
	});

	it('handles various delimiters and converts them to space', () => {
		expect(normalize('Station.Name_And-Extra')).toBe('station name and extra');
		expect(normalize('Station/Name|Other')).toBe('station name other');
	});

	it('strips typographic dashes from station names and queries', () => {
		expect(normalize('Piața–Unirii — Nord')).toBe('piata unirii nord');
		const dashStations: Station[] = [
			{ id: 1006, name: 'Piața–Unirii — Nord', description: '', lat: 44.43, lon: 26.09 },
		];
		expect(searchStations('Piata Unirii Nord', dashStations)[0].name).toBe('Piața–Unirii — Nord');
	});

	it('handles punctuation and extra whitespace together', () => {
		const punctuationStations: Station[] = [
			{ id: 1005, name: 'C.F.R. Progresul', description: '', lat: 44.43, lon: 26.09 },
		];
		expect(searchStations('  C.F.R.   Progresul  ', punctuationStations)[0].name).toBe('C.F.R. Progresul');
	});
});

describe('searchStations', () => {
	const stations: Station[] = [
		{ id: 3570, name: 'Piata Unirii', description: 'Bd. Regina Maria, Bucuresti', lat: 44.4266, lon: 26.1002 },
		{ id: 3788, name: 'Piata Unirii', description: 'Bd. Dimitrie Cantemir, Bucuresti', lat: 44.4248, lon: 26.1039 },
		{ id: 1001, name: 'Universitate', description: 'Bd. Regina Elisabeta', lat: 44.4358, lon: 26.1027 },
		{ id: 1002, name: 'Piata Romana', description: 'Bd. Magheru', lat: 44.4470, lon: 26.0971 },
		{ id: 1003, name: 'Eroilor', description: 'Bd. Eroilor', lat: 44.4350, lon: 26.0850 },
		{ id: 1004, name: 'Stefan cel Mare', description: '', lat: 44.4450, lon: 26.1100 },
		{ id: 1005, name: 'C.F.R. Progresul', description: '', lat: 44.4300, lon: 26.0900 },
		{ id: 1006, name: 'Complex @ Station', description: 'test', lat: 0, lon: 0 },
		{ id: 1007, name: 'Piata Unirii Hub', description: 'The main hub for transport', lat: 44, lon: 26 },
		{ id: 1, name: 'S', description: '', lat: 0, lon: 0 },
		{ id: 2, name: 'Short', description: '', lat: 0, lon: 0 },
		{ id: 3, name: 'Super', description: '', lat: 0, lon: 0 },
	];

	it('finds exact name matches', () => {
		const results = searchStations('Universitate', stations);
		expect(results[0].name).toBe('Universitate');
	});

	it('finds matches with exact score 100', () => {
		const results = searchStations('Piata Unirii', stations);
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('finds partial matches', () => {
		const results = searchStations('Stefan', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Stefan cel Mare');
	});

	it('handles queries with extra internal whitespace', () => {
		expect(searchStations('  Piata   Unirii  ', stations)[0].name).toBe('Piata Unirii');
	});

	it('is case insensitive', () => {
		const results = searchStations('universitate', stations);
		expect(results[0].name).toBe('Universitate');
	});

	it('respects maxResults', () => {
		const results = searchStations('Piata', stations, 2);
		expect(results).toHaveLength(2);
	});

	it('returns empty when maxResults is 0', () => {
		const results = searchStations('Piata', stations, 0);
		expect(results).toHaveLength(0);
	});

	it('returns empty for empty query', () => {
		expect(searchStations('', stations)).toHaveLength(0);
		expect(searchStations('  ', stations)).toHaveLength(0);
	});

	it('returns empty for no matches', () => {
		expect(searchStations('Nonexistent Station', stations)).toHaveLength(0);
	});

	it('handles colon', () => {
		const stations: Station[] = [{ id: 1, name: 'Station:Name', description: '', lat: 0, lon: 0 }];
		expect(searchStations('Station Name', stations)[0].name).toBe('Station:Name');
	});

	it('handles ampersand', () => {
		const stations: Station[] = [{ id: 2, name: 'Station & Co', description: '', lat: 0, lon: 0 }];
		expect(searchStations('Station Co', stations)[0].name).toBe('Station & Co');
	});

	it('searches in description too', () => {
		const results = searchStations('Magheru', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piata Romana');
	});

	it('finds matches when words are non-contiguous', () => {
		const stations: Station[] = [{ id: 2000, name: 'Station A Part B', description: '', lat: 0, lon: 0 }];
		const results = searchStations('Station B', stations);
		expect(results[0].name).toBe('Station A Part B');
	});

	it('prefers shorter names when multiple matches exist', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Short', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'Short Long Name', description: '', lat: 0, lon: 0 },
		];
		const results = searchStations('short', stations);
		expect(results).toHaveLength(2);
		expect(results[0].name).toBe('Short');
		expect(results[1].name).toBe('Short Long Name');
	});

	it('handles unexpected symbols correctly', () => {
		expect(normalize('Station@Name')).toBe('station name');
		expect(normalize('Station$Name')).toBe('station name');
		expect(normalize('Station*Name')).toBe('station name');
	});

	it('handles complex punctuation and brackets', () => {
		expect(normalize('Station [Alpha] (Beta)!')).toBe('station alpha beta');
		expect(normalize('{Test} & More')).toBe('test more');
	});

	it('handles various delimiters and converts them to space', () => {
		expect(normalize('Station.Name_And-Extra')).toBe('station name and extra');
		expect(normalize('Station/Name|Other')).toBe('station name other');
	});

	it('strips typographic dashes from station names and queries', () => {
		expect(normalize('Piața–Unirii — Nord')).toBe('piata unirii nord');
		const dashStations: Station[] = [
			{ id: 1006, name: 'Piața–Unirii — Nord', description: '', lat: 44.43, lon: 26.09 },
		];
		expect(searchStations('Piata Unirii Nord', dashStations)[0].name).toBe('Piața–Unirii — Nord');
	});

	it('handles punctuation and extra whitespace together', () => {
		const punctuationStations: Station[] = [
			{ id: 1005, name: 'C.F.R. Progresul', description: '', lat: 44.43, lon: 26.09 },
		];
		expect(searchStations('  C.F.R.   Progresul  ', punctuationStations)[0].name).toBe('C.F.R. Progresul');
	});

	it('finds matches with split words (new functionality)', () => {
		// "Uni" and "Hub" are present in Piata Unirii Hub / Central hub
		const results = searchStations('Uni Hub', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piata Unirii Hub');
	});

	it('handles multiple words matching description but not name', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Piata Unirii', description: 'The central hub for travel', lat: 44, lon: 26 },
		];
		const results = searchStations('central hub', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('sorts matches by score correctly, preferring shorter names', () => {
		const stations: Station[] = [
			{ id: 1, name: 'S', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'Short', description: '', lat: 0, lon: 0 },
			{ id: 3, name: 'Super', description: '', lat: 0, lon: 0 },
		];
		// All start with 'S'
		// S: score 80 + (10 - 1/5) = 89.8
		// Short: score 80 + (10 - 6/5) = 89.2
		// Super: score 80 + (10 - 5/5) = 89
		const results = searchStations('S', stations);
		expect(results).toHaveLength(3);
		expect(results[0].name).toBe('S');
		expect(results[1].name).toBe('Short');
		expect(results[2].name).toBe('Super');
	});
});
