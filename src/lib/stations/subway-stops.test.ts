import { describe, it, expect } from 'vitest';
import { resolveStopIds, SUBWAY_STOP_IDS } from './subway-stops.js';

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

	it('handles 0 as an invalid station', () => {
		expect(resolveStopIds(0)).toEqual([]);
	});

	it('rejects negative IDs (malformed GTFS data)', () => {
		expect(resolveStopIds(-1)).toEqual([]);
		expect(resolveStopIds(-99999)).toEqual([]);
	});

	it('rejects non-integer values', () => {
		expect(resolveStopIds(0.5)).toEqual([]);
		expect(resolveStopIds(NaN)).toEqual([]);
		expect(resolveStopIds(Infinity)).toEqual([]);
	});

	it('handles M5 stations (not in map) by returning the station ID', () => {
		// M5 station ID example (not in the map)
		expect(resolveStopIds(14777)).toEqual([14777]);
	});

	it('every subway station entry has at least 2 platform stop IDs', () => {
		for (const [gtfsId, apiIds] of Object.entries(SUBWAY_STOP_IDS)) {
			expect(apiIds.length, `station ${gtfsId} should have ≥2 stops`).toBeGreaterThanOrEqual(2);
		}
	});

	it('resolves M4 stations specifically', () => {
		expect(resolveStopIds(14742)).toEqual([9753, 9754]); // Gara de Nord 2 (M4)
		expect(resolveStopIds(57443)).toEqual([9722, 9723]); // Laminorului (M4)
	});

	it('every subway station entry has no duplicate stop IDs', () => {
		for (const [gtfsId, apiIds] of Object.entries(SUBWAY_STOP_IDS)) {
			const unique = new Set(apiIds);
			expect(unique.size, `station ${gtfsId} should have no duplicates`).toBe(apiIds.length);
		}
	});
});
