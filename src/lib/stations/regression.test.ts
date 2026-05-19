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
});
