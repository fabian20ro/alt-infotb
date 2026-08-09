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
});
