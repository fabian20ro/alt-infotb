import { describe, expect, it } from 'vitest';
import { formatCatalogDate } from './format.js';

describe('formatCatalogDate', () => {
	it('formats the source date in Romanian', () => {
		const result = formatCatalogDate('2026-07-11T13:48:53.000Z', 'ro');
		expect(result).toContain('2026');
		expect(result).toContain('iul.'); // July in Romanian
	});

	it('formats the source date in English', () => {
		expect(formatCatalogDate('2026-07-11T13:48:53.000Z', 'en')).toBe('Jul 11, 2026');
	});

	it('rejects invalid timestamps', () => {
		expect(formatCatalogDate('invalid', 'ro')).toBe('');
	});

	it('formats with day, short-month, and year in Bucharest timezone', () => {
		const result = formatCatalogDate('2026-07-11T13:48:53.000Z', 'en');
		// Pattern: "MMM dd, yyyy" — day number, short month name, 4-digit year
		expect(result).toMatch(/^\w{3}\s+\d{1,2},\s?\d{4}$/);
		// July 11 in Bucharest stays July (no DST shift at this hour)
		const [month] = result.split(/\s+/);
		expect(month).toBe('Jul');
	});

	it('rejects empty string input', () => {
		expect(formatCatalogDate('', 'ro')).toBe('');
	});

	it('formats across UTC-to-Bucharest day boundary in winter (UTC+2)', () => {
		// 2026-12-31T22:30:00Z is Jan 1, 00:30 in Bucharest (winter = UTC+2)
		const resultEn = formatCatalogDate('2026-12-31T22:30:00.000Z', 'en');
		expect(resultEn).toMatch(/^Jan\s+1,\s?2027$/);

		const resultRo = formatCatalogDate('2026-12-31T22:30:00.000Z', 'ro');
		expect(resultRo).toContain('ian.'); // January in Romanian
		expect(resultRo).toMatch(/\b2027\b/);
	});

	it('formats across UTC-to-Bucharest day boundary in summer (UTC+3)', () => {
		// 2026-07-11T22:00:00Z is Jul 12, 01:00 in Bucharest (summer = UTC+3)
		const resultEn = formatCatalogDate('2026-07-11T22:00:00.000Z', 'en');
		expect(resultEn).toMatch(/^Jul\s+12,\s?2026$/);

		const resultRo = formatCatalogDate('2026-07-11T22:00:00.000Z', 'ro');
		expect(resultRo).toContain('iul.'); // July in Romanian
		expect(resultRo).toMatch(/\b12\b/);
	});
});
