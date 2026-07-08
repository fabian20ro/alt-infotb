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
});
