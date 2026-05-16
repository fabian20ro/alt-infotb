import { describe, it, expect, vi } from 'vitest';
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

	it('switches at 4 AM Romanian time across DST-safe local boundaries', () => {
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 4, 11, 1, 30));

		try {
			expect(isNewRomanianDay(Date.UTC(2026, 4, 11, 0, 59))).toBe(true);
			expect(isNewRomanianDay(Date.UTC(2026, 4, 11, 1, 1))).toBe(false);
		} finally {
			nowSpy.mockRestore();
		}
	});
});
