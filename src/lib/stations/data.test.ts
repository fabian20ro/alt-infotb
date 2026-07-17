import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isNewRomanianDay, loadStations } from './data.js';

// Mock the db module so we can control getStations/saveStations/getLastRefreshTime/updateLastRefreshTime
vi.mock('./db.js', () => ({
	getStations: vi.fn().mockResolvedValue([]),
	saveStations: vi.fn().mockResolvedValue(undefined),
	getLastRefreshTime: vi.fn().mockResolvedValue(0),
	updateLastRefreshTime: vi.fn().mockResolvedValue(undefined)
}));

import { getStations, saveStations, getLastRefreshTime, updateLastRefreshTime } from './db.js';

// Import checkAndRefresh indirectly via loadStations so the stale-refresh path runs.

const cachedStation = [{ id: 'test-1', name: 'Test Station' }] as const;

describe('isNewRomanianDay', () => {
	// Fixed timestamps in Bucharest time to ensure determinism
	// We use UTC times that are guaranteed to fall on different Romanian days
	// regardless of the environment's offset (assuming -1 to +3)
	
	it('returns true for a timestamp from yesterday', () => {
		const yesterday = new Date('2026-06-13T12:00:00Z').getTime();
		const now = new Date('2026-06-14T12:00:00Z').getTime();
		expect(isNewRomanianDay(yesterday, now)).toBe(true);
	});

	it('returns false for a timestamp from today (after 4 AM)', () => {
		const lastRefresh = new Date('2026-06-15T10:00:00Z').getTime();
		const now = new Date('2026-06-15T11:00:00Z').getTime();
		expect(isNewRomanianDay(lastRefresh, now)).toBe(false);
	});

	it('crosses the 4 AM Bucharest boundary between before/after timestamps', () => {
		// Sub-case A: coarse boundary crossing (same as original tests at lines 35-41 and 56-60)
		const coarseBefore = new Date('2026-06-15T00:00:00Z').getTime();   // ~01:00 EET (< 4)
		const coarseAfter = new Date('2026-06-15T05:00:00Z').getTime();    // ~06:00 EET (>= 4)
		expect(isNewRomanianDay(coarseBefore, coarseAfter)).toBe(true);

		// Sub-case B: exact boundary transition at 01:00 UTC / 03:59→04:00 Bucharest
		const beforeExact = new Date('2026-06-15T00:59:59Z').getTime();     // 03:59:59 EET (< 4) → day N-1
		const afterExact = new Date('2026-06-15T01:00:00Z').getTime();      // 04:00:00 EET (= 4) → day N
		expect(isNewRomanianDay(beforeExact, afterExact)).toBe(true);

		// Sub-case C: same transit day when both at/after boundary
		const afterBoundary = new Date('2026-06-15T01:00:01Z').getTime();   // 04:00:01 EEST (>= 4) → still day N
		expect(isNewRomanianDay(afterExact, afterBoundary)).toBe(false);

		// Sub-case D: same transit day when both before boundary (< 4 AM Bucharest)
		const now = new Date('2026-06-15T12:00:00Z').getTime();
		const recent = now - 1000;
		expect(isNewRomanianDay(recent, now)).toBe(false);
	});

	it('returns true for an uninitialized timestamp (0)', () => {
		const now = new Date('2026-06-15T12:00:00Z').getTime();
		expect(isNewRomanianDay(0, now)).toBe(true);
	});

	it('handles leap year transitions correctly', () => {
		const before = new Date('2024-02-28T05:00:00Z').getTime();
		const after = new Date('2024-02-29T05:00:00Z').getTime();
		expect(isNewRomanianDay(before, after)).toBe(true);
	});

	it('detects the 4 AM Bucharest boundary under EET (UTC+2)', () => {
		// January is EET in Bucharest (UTC+2), so:
		//   01:59:59Z → 03:59:59 Bucharest (< 4) → previous transit day
		//   02:00:00Z → 04:00:00 Bucharest (= 4)  → current transit day
		const beforeBoundary = new Date('2026-01-15T01:59:59Z').getTime();
		const afterBoundary = new Date('2026-01-15T02:00:00Z').getTime();
		expect(isNewRomanianDay(beforeBoundary, afterBoundary)).toBe(true);

		// Same transit day — both at or after the 4 AM boundary under EET
		const sameDay = new Date('2026-01-15T03:00:00Z').getTime();
		expect(isNewRomanianDay(afterBoundary, sameDay)).toBe(false);
	});

	it('handles spring-forward DST transition (March 28–29, 2026)', () => {
		// Spring forward: clocks jump from 03:00 EET to 04:00 EEST at 01:00Z.
		//   23:59:59Z Mar 28 → 01:59:59 EET (hour=1, < 4) → previous transit day
		//   00:00:00Z Mar 29 → 03:00 EET (hour=3, < 4) → still same transit day
		const before = new Date('2026-03-28T23:59:59Z').getTime();
		const justBeforeBoundary = new Date('2026-03-29T00:59:59Z').getTime();
		expect(isNewRomanianDay(before, justBeforeBoundary)).toBe(false);

		// After transition: 01:00:01Z → 04:00:01 EEST (hour=4, >= 4) → new transit day
		const afterTransition = new Date('2026-03-29T01:00:01Z').getTime();
		expect(isNewRomanianDay(justBeforeBoundary, afterTransition)).toBe(true);
	});

	it('handles fall-back DST transition (October 25, 2026)', () => {
		// Fall back: clocks go from 04:00 EEST to 03:00 EET.
		//   Noon UTC = 15:00 EEST → hour >= 4
		//   After transition at 02:00Z = 03:00 EET → still in same transit day
		const beforeTransition = new Date('2026-10-25T12:00:00Z').getTime();
		const duringTransition = new Date('2026-10-25T02:30:00Z').getTime();
		expect(isNewRomanianDay(duringTransition, beforeTransition)).toBe(false);

		// Before transition — same transit day as the next morning under EET
		const nextMorning = new Date('2026-10-25T04:00:00Z').getTime(); // 07:00 EEST / 06:00 EET, both >= 4
		expect(isNewRomanianDay(beforeTransition, nextMorning)).toBe(false);
	});

	it('detects the 4 AM Bucharest boundary under EEST (UTC+3) in pure summer time', () => {
		// In June, Bucharest is in EEST (UTC+3).
		//   00:59 UTC → 03:59 EEST (< 4) → previous transit day
		//   01:00 UTC → 04:00 EEST (= 4)  → current transit day
		const beforeBoundary = new Date('2026-06-16T00:59:59Z').getTime(); // 03:59 EEST, crosses into next transit day below
		const afterBoundary = new Date('2026-06-16T01:00:01Z').getTime(); // 04:00 EEST, same calendar date but next transit day
		expect(isNewRomanianDay(beforeBoundary, afterBoundary)).toBe(true);

		// Both at or after the 4 AM boundary — same transit day under EEST
		const laterSameDay = new Date('2026-06-16T05:00:00Z').getTime(); // 08:00 EEST
		expect(isNewRomanianDay(afterBoundary, laterSameDay)).toBe(false);

		// Both before the boundary — same transit day under EEST
		const earlier = new Date('2026-06-16T00:30:00Z').getTime(); // 03:30 EEST
		expect(isNewRomanianDay(earlier, beforeBoundary)).toBe(false);
	});

	it('detects cross-midnight UTC within the same transit day', () => {
		// Two timestamps on different calendar dates but mapping to the
		// SAME Bucharest local date — both before 4 AM EET. They must be
		// in the *same* transit day because getRomanianDayNumber uses
		// Bucharest local date as its base, adjusted only for hour < 4.
		//   Jan 15, 23:30Z → 01:30 EET (day=16, hour<4) → day N transit
		//   Jan 16, 00:30Z → 02:30 EET (day=16, hour<4) → same day N transit
		const beforeMidnight = new Date('2026-01-15T23:30:00Z').getTime(); // 01:30 EET on Jan 16 local
		const afterMidnight = new Date('2026-01-16T00:30:00Z').getTime();   // 02:30 EET on same day
		expect(isNewRomanianDay(beforeMidnight, afterMidnight)).toBe(false);

		// Same Bucharest date but both at or after boundary — still same transit day
		const beforeBoundary = new Date('2026-01-15T23:40:00Z').getTime(); // 01:40 EET, day 16 local, hour<4 → adjusted day
		const atBoundary = new Date('2026-01-16T02:00:00Z').getTime();     // 04:00 EET, day 16 local, hour=4 → same base day (no -1)
		// beforeBoundary: day=16, hour=1 (<4), so dayNumber = Date.UTC(2026,0,16)/86_400_000 - 1
		// atBoundary: day=16, hour=4 (>=4), so dayNumber = Date.UTC(2026,0,16)/86_400_000
		// Different! atBoundary is in next transit day.
		expect(isNewRomanianDay(beforeBoundary, atBoundary)).toBe(true);

		// Reversed: going back from after to before boundary = false (day decreases)
		expect(isNewRomanianDay(atBoundary, beforeMidnight)).toBe(false);
	});

	it('detects the same transit day across two calendar nights', () => {
		// Two timestamps in UTC both on the SAME Bucharest local date
		// and both before 4 AM — must yield false.
		const a = new Date('2026-01-15T23:00:00Z').getTime(); // 01:00 EET, day 16 local
		const b = new Date('2026-01-16T00:00:00Z').getTime(); // 02:00 EET, same day 16 local
		expect(isNewRomanianDay(a, b)).toBe(false);

		// Same calendar date but both after boundary — still same transit day
		const c = new Date('2026-01-15T23:45:00Z').getTime(); // 01:45 EET (day 16 local, hour<4) → adjusted day
		expect(isNewRomanianDay(c, a)).toBe(false);

		// Same UTC date but one before boundary and one after — different transit days
		const d = new Date('2026-01-15T23:59:00Z').getTime(); // 01:59 EET (day 16 local, hour<4) → adjusted day N-1
		const e = new Date('2026-01-16T02:00:00Z').getTime(); // 04:00 EET (day 16 local, hour>=4) → same base day N
		expect(isNewRomanianDay(d, e)).toBe(true); // crosses boundary into new transit day
	});

	it('detects the boundary crossing under EET within one calendar day', () => {
		// Both on Jan 15, 2026 in Bucharest time:
		//   01:30Z = 03:30 EET (< 4) → previous transit day (N-1)
		//   02:30Z = 04:30 EET (>= 4) → current transit day (N)
		const before = new Date('2026-01-15T01:30:00Z').getTime(); // 03:30 EET
		const after = new Date('2026-01-15T02:30:00Z').getTime(); // 04:30 EET
		expect(isNewRomanianDay(before, after)).toBe(true);

		// Reversed — going back in time should give false (day N → day N-1)
		expect(isNewRomanianDay(after, before)).toBe(false);
	});

	it('returns false when both timestamps are at or after the 4 AM boundary on the same transit day', () => {
		// Both well after 4 AM Bucharest — must be in the SAME transit day.
		const a = new Date('2026-01-15T03:00:00Z').getTime(); // 05:00 EET (hour=5 >= 4)
		const b = new Date('2026-01-15T12:00:00Z').getTime(); // 14:00 EET (hour=14 >= 4)
		expect(isNewRomanianDay(a, b)).toBe(false);

		// Exact boundary hour (=4 Bucharest) is still the same transit day.
		const atBoundary = new Date('2026-01-15T02:00:00Z').getTime(); // 04:00 EET (hour=4 >= 4)
		expect(isNewRomanianDay(atBoundary, b)).toBe(false);
	});
});

describe('loadStations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns cached stations from IndexedDB without saving bundled data', async () => {
		(getStations as ReturnType<typeof vi.fn>).mockResolvedValue(cachedStation);

		const { stations, refreshDone } = await loadStations();

		expect(stations).toEqual(cachedStation);
		expect(saveStations).not.toHaveBeenCalled();
		await expect(refreshDone).resolves.toBeUndefined(); // resolves silently
	});

	it('calls updateLastRefreshTime when cached data is stale', async () => {
		const nowMs = Date.now();
		const twoDaysAgoMs = nowMs - 2 * 86_400_000;

		(getStations as ReturnType<typeof vi.fn>).mockResolvedValue(cachedStation);
		(getLastRefreshTime as ReturnType<typeof vi.fn>).mockResolvedValue(twoDaysAgoMs);

		const { refreshDone } = await loadStations();
		await refreshDone;

		expect(updateLastRefreshTime).toHaveBeenCalledTimes(1);
	});

	it('does not call updateLastRefreshTime when cached data is fresh', async () => {
		const nowMs = Date.now();

		(getStations as ReturnType<typeof vi.fn>).mockResolvedValue(cachedStation);
		(getLastRefreshTime as ReturnType<typeof vi.fn>).mockResolvedValue(nowMs);

		const { refreshDone } = await loadStations();
		await refreshDone;

		expect(updateLastRefreshTime).not.toHaveBeenCalled();
	});

	it('falls back to bundled data when cache is empty', async () => {
		const defaultGetStations = (getStations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		const result = await loadStations();

		// Cache was empty → should fall through to bundled fallback and call saveStations
		expect(saveStations).toHaveBeenCalledTimes(1);
		// Bundled data is loaded from stations.json — not controllable, but must be a real array
		expect(result.stations).toBeInstanceOf(Array);
		expect(result.stations.length).toBeGreaterThan(100); // real bundled stations
	});

	it('falls back to bundled data when IndexedDB throws (private browsing)', async () => {
		(getStations as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('IndexedDB unavailable'));

		const result = await loadStations();

		// Should not crash and should return the bundled station list via fallback path
		expect(saveStations).toHaveBeenCalledTimes(1);
		expect(result.stations).toBeInstanceOf(Array);
		expect(result.stations.length).toBeGreaterThan(100); // real bundled data
	});

	it('refreshes stale cached data in the background and resolves silently', async () => {
		const oldTimestamp = new Date('2026-01-14T12:00:00Z').getTime(); // yesterday UTC

		(getStations as ReturnType<typeof vi.fn>).mockResolvedValue(cachedStation);
		(getLastRefreshTime as ReturnType<typeof vi.fn>).mockResolvedValue(oldTimestamp);

		const { stations, refreshDone } = await loadStations();

		expect(stations).toEqual(cachedStation);
		await expect(refreshDone).resolves.toBeUndefined(); // resolves silently after background check
		expect(updateLastRefreshTime).toHaveBeenCalledTimes(1);
	});
});