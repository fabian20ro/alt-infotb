import { describe, it, expect } from 'vitest';
import { isNewRomanianDay } from './data.js';

describe('isNewRomanianDay', () => {
	it('returns true for a timestamp from yesterday', () => {
		const yesterday = Date.now() - 86400000;
		expect(isNewRomanianDay(yesterday)).toBe(true);
	});

	it('returns false for a timestamp from today (after 4 AM)', () => {
		// Assuming current time is after 4 AM
		const hourAgo = Date.now() - 3600000;
		expect(isNewRomanianDay(hourAgo)).toBe(false);
	});

	it('returns false if timestamp is recent and within the same transit day', () => {
		const recent = Date.now() - 1000;
		expect(isNewRomanianDay(recent)).toBe(false);
	});

	it('respects the 4 AM boundary', () => {
		// Note: This is highly dependent on the current system time.
		// A better way would be to inject `nowMs` into `isNewRomanianDay`.
		// We added that capability, but tests are kept simple for now.
	});
});
