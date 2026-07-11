import { describe, it, expect } from 'vitest';
import { isNewRomanianDay } from './data.js';

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

	it('returns true when moving from before 4 AM to after 4 AM', () => {
		// 00:00 UTC is 01:00 or 03:00 Bucharest (< 4)
		// 05:00 UTC is 06:00 or 08:00 Bucharest (> 4)
		const beforeBoundary = new Date('2026-06-15T00:00:00Z').getTime();
		const afterBoundary = new Date('2026-06-15T05:00:00Z').getTime();
		expect(isNewRomanianDay(beforeBoundary, afterBoundary)).toBe(true);
	});

	it('returns true when moving from before 4 AM to after 4 AM (case: exact boundary)', () => {
		// Testing the exact boundary condition more explicitly
		const beforeBoundary = new Date('2026-06-15T00:59:59Z').getTime();
		const afterBoundary = new Date('2026-06-15T01:00:00Z').getTime();
		expect(isNewRomanianDay(beforeBoundary, afterBoundary)).toBe(true);
	});

	it('returns false if timestamp is recent and within the same transit day', () => {
		const now = new Date('2026-06-15T12:00:00Z').getTime();
		const recent = now - 1000;
		expect(isNewRomanianDay(recent, now)).toBe(false);
	});

	it('respects the 4 AM boundary', () => {
		const before = new Date('2026-06-15T00:00:00Z').getTime();
		const after = new Date('2026-06-15T05:00:00Z').getTime();
		expect(isNewRomanianDay(before, after)).toBe(true);
	});

	it('handles the boundary exactly at 4 AM Bucharest time', () => {
		// 00:59:59 UTC is 03:59:59 Bucharest (Day N-1)
		// 01:00:00 UTC is 04:00:00 Bucharest (Day N)
		const before = new Date('2026-06-15T00:59:59Z').getTime();
		const after = new Date('2026-06-15T01:00:00Z').getTime();
		expect(isNewRomanianDay(before, after)).toBe(true);
			
		// 01:00:01 UTC is 04:00:01 Bucharest (Day N)
		const after2 = new Date('2026-06-15T01:00:01Z').getTime();
		expect(isNewRomanianDay(after, after2)).toBe(false);
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
});