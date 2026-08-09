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
});
