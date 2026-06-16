import { describe, it, expect } from 'vitest';
import { formatLastUpdate } from './format.js';

describe('formatLastUpdate', () => {
	it('formats date in English', () => {
		const ts = new Date('2026-06-11T10:11:00Z').getTime();
		// Note: exact format can depend on environment, but should be close to 'Jun 11, 2026, 10:11 AM'
		const formatted = formatLastUpdate(ts, 'en');
		expect(formatted).toContain('Jun 11, 2026');
	});

	it('formats date in Romanian', () => {
		const ts = new Date('2026-06-11T10:11:00Z').getTime();
		// Romanian format usually: 11 iun. 2026, 10:11
		const formatted = formatLastUpdate(ts, 'ro');
		expect(formatted).toContain('11');
		expect(formatted).toContain('iun');
		expect(formatted).toContain('2026');
	});

	it('returns empty for invalid timestamp', () => {
		expect(formatLastUpdate(NaN, 'en')).toBe('');
		expect(formatLastUpdate(undefined, 'en')).toBe('');
		expect(formatLastUpdate(null, 'en')).toBe('');
	});

	it('formats timestamp 0 correctly', () => {
		const formatted = formatLastUpdate(0, 'en');
		expect(formatted).toContain('Jan 1, 1970');
	});
});
