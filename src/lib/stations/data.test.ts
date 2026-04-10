import { describe, it, expect } from 'vitest';
import { isNewRomanianDay } from './data.js';

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
