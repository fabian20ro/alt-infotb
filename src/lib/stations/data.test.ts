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
});