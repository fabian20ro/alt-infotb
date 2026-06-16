import { describe, it, expect } from 'vitest';
import { resolveStopIds } from './subway-stops.js';

describe('resolveStopIds', () => {
	it('resolves known station with multiple stops (interchange)', () => {
		expect(resolveStopIds(15102)).toEqual([9645, 9646, 9647, 9864]); // Nicolae Grigorescu (M1+M3 interchange)
		expect(resolveStopIds(14697)).toEqual([9653, 9654, 9656, 9657]); // Dristor 1+2 (M1+M3 interchange)
	});

	it('resolves known station with two stops', () => {
		expect(resolveStopIds(14718)).toEqual([9629, 9630]); // Pantelimon
	});

	it('resolves unknown station by returning the station ID itself', () => {
		expect(resolveStopIds(12345)).toEqual([12345]);
	});

	it('handles 0 as an unknown station', () => {
		expect(resolveStopIds(0)).toEqual([0]);
	});

	it('handles M5 stations (not in map) by returning the station ID', () => {
		// M5 station ID example (not in the map)
		expect(resolveStopIds(14777)).toEqual([14777]);
	});
});
