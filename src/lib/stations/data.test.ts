import { describe, it, expect } from 'vitest';
import { getRomanianDayNumber, isNewRomanianDay } from './data.js';

describe('getRomanianDayNumber', () => {
	it('returns the same day number for timestamps on the same Romanian day after 4 AM', () => {
		// Feb 15, 2026 10:00 Romanian time (UTC+2) = 08:00 UTC
		const morning = new Date('2026-02-15T08:00:00Z').getTime();
		// Feb 15, 2026 23:00 Romanian time (UTC+2) = 21:00 UTC
		const evening = new Date('2026-02-15T21:00:00Z').getTime();

		expect(getRomanianDayNumber(morning)).toBe(getRomanianDayNumber(evening));
	});

	it('treats 3:59 AM Romanian time as the previous day', () => {
		// Feb 16, 2026 03:59 Romanian time (UTC+2) = 01:59 UTC
		const before4am = new Date('2026-02-16T01:59:00Z').getTime();
		// Feb 15, 2026 22:00 Romanian time (UTC+2) = 20:00 UTC
		const previousEvening = new Date('2026-02-15T20:00:00Z').getTime();

		expect(getRomanianDayNumber(before4am)).toBe(getRomanianDayNumber(previousEvening));
	});

	it('treats 4:00 AM Romanian time as the next day', () => {
		// Feb 16, 2026 04:00 Romanian time (UTC+2) = 02:00 UTC
		const at4am = new Date('2026-02-16T02:00:00Z').getTime();
		// Feb 15, 2026 22:00 Romanian time (UTC+2) = 20:00 UTC
		const previousEvening = new Date('2026-02-15T20:00:00Z').getTime();

		expect(getRomanianDayNumber(at4am)).toBeGreaterThan(getRomanianDayNumber(previousEvening));
	});

	it('gives different day numbers for consecutive days at noon', () => {
		// Feb 15, 2026 12:00 Romanian time = 10:00 UTC
		const day1 = new Date('2026-02-15T10:00:00Z').getTime();
		// Feb 16, 2026 12:00 Romanian time = 10:00 UTC
		const day2 = new Date('2026-02-16T10:00:00Z').getTime();

		expect(getRomanianDayNumber(day2) - getRomanianDayNumber(day1)).toBe(1);
	});

	it('handles midnight correctly (still previous transit day)', () => {
		// Feb 16, 2026 00:00 Romanian time (UTC+2) = Feb 15 22:00 UTC
		const midnight = new Date('2026-02-15T22:00:00Z').getTime();
		// Feb 15, 2026 12:00 Romanian time (UTC+2) = 10:00 UTC
		const sameTransitDay = new Date('2026-02-15T10:00:00Z').getTime();

		expect(getRomanianDayNumber(midnight)).toBe(getRomanianDayNumber(sameTransitDay));
	});
});

describe('isNewRomanianDay', () => {
	it('returns true when lastRefresh is 0', () => {
		expect(isNewRomanianDay(0)).toBe(true);
	});

	it('returns false when lastRefresh is recent (same transit day)', () => {
		// A few minutes ago is the same day
		const recent = Date.now() - 5 * 60 * 1000;
		expect(isNewRomanianDay(recent)).toBe(false);
	});

	it('returns true when lastRefresh was yesterday', () => {
		// 48 hours ago is definitely a previous transit day
		const old = Date.now() - 48 * 60 * 60 * 1000;
		expect(isNewRomanianDay(old)).toBe(true);
	});
});
