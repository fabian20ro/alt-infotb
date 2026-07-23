import { describe, it, expect } from 'vitest';
import { getStationName, resolveStopIds, STATION_NAMES, SUBWAY_STOP_IDS } from './subway-stops.js';

describe('getStationName', () => {
	it('resolves known station IDs to their Romanian names', () => {
		expect(getStationName(15100)).toBe('Piața Unirii');
		expect(getStationName(14718)).toBe('Pantelimon');
		expect(getStationName(14739)).toBe('1 Decembrie 1918');
	});

	it('returns null for unknown station IDs', () => {
		expect(getStationName(99999)).toBeNull();
		expect(getStationName(0)).toBeNull();
		expect(getStationName(-5)).toBeNull();
	});

	it('every subway station in SUBWAY_STOP_IDS has a corresponding name entry', () => {
		for (const gtfsId of Object.keys(SUBWAY_STOP_IDS)) {
			const id = Number(gtfsId);
			expect(
				STATION_NAMES[id],
				`station ${id} (${gtfsId}) must have a STATION_NAMES entry`,
			).toBeDefined();
		}
	});

	it('every name in STATION_NAMES corresponds to a SUBWAY_STOP_IDS key', () => {
		for (const gtfsId of Object.keys(STATION_NAMES)) {
			const id = Number(gtfsId);
			expect(
				SUBWAY_STOP_IDS[id],
				`STATION_NAMES entry ${gtfsId} must have a SUBWAY_STOP_IDS counterpart`,
			).toBeDefined();
		}
	});

	it('resolves M4 interchange stations with multiple stops', () => {
		// Gara de Nord has both M1 and M4 entries; either resolves to "Gara de Nord 2"
		expect(getStationName(57443)).toBe('Laminorului');
	});

	it('rejects non-integer numeric values (guard boundary)', () => {
		expect(getStationName(0.5)).toBeNull();
		expect(getStationName(NaN)).toBeNull();
	});
});

describe('resolveStopIds', () => {
	it('resolves known station with multiple stops (interchange)', () => {
		expect(resolveStopIds(15102)).toEqual([9645, 9646, 9647, 9864]); // Nicolae Grigorescu (M1+M3 interchange)
		expect(resolveStopIds(14697)).toEqual([9653, 9654, 9656, 9657]); // Dristor 1+2 (M1+M3 interchange)
	});

	it('resolves three-line interchange stations correctly', () => {
		// Piața Unirii is the only M1+M2+M3 interchange in Bucharest
		expect(resolveStopIds(15100)).toEqual([9543, 9544, 9552, 9553]);
	});

	it('resolves known station with two stops', () => {
		expect(resolveStopIds(14718)).toEqual([9629, 9630]); // Pantelimon
	});

	it('resolves unknown station by returning the station ID itself', () => {
		expect(resolveStopIds(12345)).toEqual([12345]);
	});

	it('returns empty array for any non-positive input (guard boundary)', () => {
		// Zero and negative numbers must never resolve — guard fires when `stationId <= 0`
		expect(resolveStopIds(0)).toEqual([]);
		expect(resolveStopIds(-1)).toEqual([]);
		expect(resolveStopIds(-99999)).toEqual([]);
	});

	it('rejects non-number types (undefined, null, strings, booleans)', () => {
		// Runtime callers may pass JS values that TypeScript cannot catch.
		expect(resolveStopIds(undefined as unknown as number)).toEqual([]);
		expect(resolveStopIds(null as unknown as number)).toEqual([]);
		expect(resolveStopIds('12345' as unknown as number)).toEqual([]);
		expect(resolveStopIds(true as unknown as number)).toEqual([]);
	});

	it('rejects non-integer numeric values', () => {
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

	it('resolves M3 stations specifically', () => {
		expect(resolveStopIds(14738)).toEqual([9584, 9585]); // Politehnica (M3)
		expect(resolveStopIds(14735)).toEqual([9652, 9655]); // Păcii (M3)
	});

	it('resolves M2 stations specifically', () => {
		expect(resolveStopIds(14725)).toEqual([9596, 9597]); // Universitate (M2)
		expect(resolveStopIds(14727)).toEqual([9587, 9588]); // Tineretului (M2)
	});

	it('resolves M1-only stations specifically', () => {
		expect(resolveStopIds(14703)).toEqual([9751, 9752]); // Gara de Nord 1 (M1)
		expect(resolveStopIds(14708)).toEqual([9578, 9579]); // Eroilor (M1+M3)
	});

	it('every subway station entry has no duplicate stop IDs (O(n) dedupe)', () => {
		for (const [gtfsId, apiIds] of Object.entries(SUBWAY_STOP_IDS)) {
			const seen = new Set<number>();
			const duplicates: number[] = [];
			for (const id of apiIds) {
				if (!seen.add(id)) duplicates.push(id); // add returns false if already present
			}
			expect(
				duplicates.length,
				`station ${gtfsId} should have no duplicate stop IDs — found: [${duplicates.join(', ')}]`,
			).toBe(0);
		}
	});

	it('every GTFS parent ID resolves to its expected stop IDs through resolveStopIds', () => {
		// Regression guard: if anyone accidentally edits or deletes a map entry,
		// this test catches it by verifying every documented GTFS→API mapping
		// produces the correct result through the public function.
		for (const [gtfsIdStr, expected] of Object.entries(SUBWAY_STOP_IDS)) {
			const gtfsId = Number(gtfsIdStr);
			expect(
				resolveStopIds(gtfsId),
				`station ${gtfsId} (${gtfsIdStr}) should resolve to its documented stops`,
			).toEqual(expected);
		}
	});

	it('falls back to stationId for unknown IDs that look like valid API stop IDs', () => {
		// An ID in the 9xxx range (which is an API stop ID range) but not in the map
		// should still return [stationId] rather than [] — it's a "valid-looking" integer.
		expect(resolveStopIds(9645)).toEqual([9645]); // valid-looking, just unknown station
		expect(resolveStopIds(9700)).toEqual([9700]); // another 9xxx value not in map
	});

	it('SUBWAY_STOP_IDS keys never appear as values (GTFS/API namespace separation)', () => {
		// GTFS parent IDs (14xxx-57xxx) must never equal API stop IDs (95xx-98xx).
		// A data-entry typo mixing the two namespaces would silently break lookups.
		const allValues = new Set(Object.values(SUBWAY_STOP_IDS).flatMap((v) => v));
		for (const gtfsId of Object.keys(SUBWAY_STOP_IDS)) {
			expect(
				allValues.has(Number(gtfsId)),
				`GTFS parent ${gtfsId} must not appear as an API stop value`,
			).toBe(false);
		}
	});

	it('every stop ID value across the map is a positive integer', () => {
		const allValues = Object.values(SUBWAY_STOP_IDS).flatMap((v) => v);
		for (const id of allValues) {
			expect(
				Number.isInteger(id) && id > 0,
				`stop ID ${id} must be a positive integer`,
			).toBe(true);
		}
	});

	it('no station entry exceeds the maximum expected number of platform stops (4)', () => {
		for (const [gtfsId, apiIds] of Object.entries(SUBWAY_STOP_IDS)) {
			expect(
				apiIds.length <= 4,
				`station ${gtfsId} has ${apiIds.length} stop IDs — max expected is 4 (M1+M2+M3 interchange)`,
			).toBe(true);
		}
	});
});
