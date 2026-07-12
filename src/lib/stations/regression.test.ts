import { describe, it, expect } from 'vitest';
import { normalize, searchStations } from './search.js';
import type { Station } from './types.js';

describe('Regression tests for punctuation', () => {
	it('handles plus sign', () => {
		const stations: Station[] = [{ id: 1, name: 'Station+Name', description: '', lat: 0, lon: 0 }];
		expect(searchStations('Station Name', stations)).toHaveLength(1);
	});

	it('handles ampersand', () => {
		const stations: Station[] = [{ id: 2, name: 'Station & Co', description: '', lat: 0, lon: 0 }];
		expect(searchStations('Station Co', stations)).toHaveLength(1);
	});

	it('handles underscore', () => {
		const stations: Station[] = [{ id: 3, name: 'Station_Name', description: '', lat: 0, lon: 0 }];
		expect(searchStations('Station Name', stations)).toHaveLength(1);
	});

	it('normalizes diacritics in station names and queries', () => {
		const stations: Station[] = [{ id: 4, name: 'Piața Unirii', description: '', lat: 0, lon: 0 }];
		expect(searchStations('Piața Unirii', stations)).toHaveLength(1);
		expect(searchStations('Piata Unirii', stations)).toHaveLength(1);
		expect(normalize('Șosea').toLowerCase()).toBe('sosea');
	});

	it('matches numeric station IDs directly', () => {
		const stations: Station[] = [
			{ id: 42, name: 'Gara de Nord', description: '', lat: 0, lon: 0 },
			{ id: 99, name: 'Piața Romană', description: '', lat: 0, lon: 0 }
		];
		expect(searchStations('42', stations)).toHaveLength(1);
		expect(searchStations('42', stations)[0].id).toBe(42);
	});

	it('collapses repeated whitespace in names and queries', () => {
		const stations: Station[] = [{ id: 5, name: 'Strada   Principală', description: '', lat: 0, lon: 0 }];
		expect(searchStations('Strada Principală', stations)).toHaveLength(1);
	});

	it('treats dashes as spaces in station names', () => {
		const stations: Station[] = [{ id: 6, name: 'Piața–Unirii — Nord', description: '', lat: 0, lon: 0 }];
		expect(searchStations('Piața Unirii Nord', stations)).toHaveLength(1);
	});

	it('returns empty array for an empty query', () => {
		const stations: Station[] = [{ id: 7, name: 'Any Station', description: '', lat: 0, lon: 0 }];
		expect(searchStations('', stations)).toHaveLength(0);
	});

	it('handles numeric query "0" when no station has id 0', () => {
		const stations: Station[] = [
			{ id: 1, name: 'A', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'B', description: '', lat: 0, lon: 0 }
		];
		expect(searchStations('0', stations)).toHaveLength(0);
	});

	it('matches numeric query with leading zeros via parseInt coercion', () => {
		const stations: Station[] = [{ id: 42, name: 'Gara de Nord', description: '', lat: 0, lon: 0 }];
		expect(searchStations('042', stations)).toHaveLength(1);
	});

	it('handles numeric query exceeding safe integer range without crashing', () => {
		const stations: Station[] = [{ id: 1, name: 'A', description: '', lat: 0, lon: 0 }];
		expect(searchStations('99999999999999999999', stations)).toHaveLength(0);
	});

	it('handles null/undefined stations parameter', () => {
		expect(searchStations('anything', null)).toHaveLength(0);
		expect(searchStations('anything', undefined)).toHaveLength(0);
	});

	it('matches via description field when name does not match', () => {
		const stations: Station[] = [
			{ id: 8, name: 'Gara de Nord', description: 'Main railway station in Bucharest', lat: 0, lon: 0 }
		];
		expect(searchStations('railway station', stations)).toHaveLength(1);
	});

	it('respects maxResults cap', () => {
		const stations: Station[] = [
			{ id: 1, name: 'A Station', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'B Station', description: '', lat: 0, lon: 0 },
			{ id: 3, name: 'C Station', description: '', lat: 0, lon: 0 },
			{ id: 4, name: 'D Station', description: '', lat: 0, lon: 0 }
		];
		expect(searchStations('station', stations, 2)).toHaveLength(2);
	});

	it('matches case-insensitively via normalize lowercasing', () => {
		const stations: Station[] = [
			{ id: 10, name: 'Gara de Nord', description: '', lat: 0, lon: 0 },
			{ id: 11, name: 'Piața Romană', description: '', lat: 0, lon: 0 }
		];
		expect(searchStations('GARA DE NORD', stations)).toHaveLength(1);
		expect(searchStations('PIAȚA ROMANĂ', stations)).toHaveLength(1);
	});

	it('matches multi-word query where words span name and description fields', () => {
		const stations: Station[] = [
			{ id: 20, name: 'Gara', description: 'Central station', lat: 0, lon: 0 }
		];
		expect(searchStations('Gara Central', stations)).toHaveLength(1);
	});

	it('returns empty array for an empty station array (not null/undefined)', () => {
		expect(searchStations('anything', [])).toHaveLength(0);
	});

	it('strips quotes from names and queries via normalize', () => {
		const stations: Station[] = [
			{ id: 30, name: '"Central" Station', description: "''Test'' Station", lat: 0, lon: 0 }
		];
		expect(searchStations('central station', stations)).toHaveLength(1);
	});

	it('handles period-separated acronyms like C.F.R. in normalize and search', () => {
		const stations: Station[] = [
			{ id: 40, name: 'C.F.R. Călători', description: '', lat: 0, lon: 0 }
		];
		expect(searchStations('CFR Calatori', stations)).toHaveLength(1);
	});

	it('strips untested punctuation (parens, brackets, slashes, @, !, #) via normalize non-alnum rule', () => {
		const stations: Station[] = [
			{ id: 50, name: 'Gara (Centrală)', description: '', lat: 0, lon: 0 },
			{ id: 51, name: 'Strada [Nouă]', description: '', lat: 0, lon: 0 },
			{ id: 52, name: 'Piața / Nord', description: '', lat: 0, lon: 0 }
		];
		expect(searchStations('Gara Centrală', stations)).toHaveLength(1);
		expect(searchStations('Strada Noua', stations)).toHaveLength(1);
		expect(searchStations('Piața Nord', stations)).toHaveLength(1);
		expect(normalize('(test) [foo] bar/baz').toLowerCase()).toBe('test foo bar baz');
	});

	it('strips special characters @ ! # ; , from names and queries via normalize', () => {
		const stations: Station[] = [
			{ id: 60, name: 'Station @ Hub!', description: '', lat: 0, lon: 0 }
		];
		expect(searchStations('station hub', stations)).toHaveLength(1);
		expect(normalize('test # hash ; semicolon , comma').toLowerCase()).toBe('test hash semicolon comma');
	});

	it('handles mixed punctuation with diacritics in station name and query', () => {
		const stations: Station[] = [
			{ id: 70, name: 'Gara (Piața) Șosea! Centrală', description: '', lat: 0, lon: 0 }
		];
		expect(searchStations('Gara Piața Sosea Centrală', stations)).toHaveLength(1);
	});

	it('handles normalize with multiple consecutive special characters collapsing to single space', () => {
		const result = normalize('a!!!b@@c//d[e]f').toLowerCase();
		expect(result).toBe('a b c d e f');
		expect(normalize('x;;;y,,,z???w##v').toLowerCase()).toBe('x y z w v');
	});
});
