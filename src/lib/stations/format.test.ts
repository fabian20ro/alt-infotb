import { describe, it, expect } from 'vitest';
import { formatLastUpdate } from './format.js';

describe('formatLastUpdate', () => {
	it('returns empty string when timestamp is 0', () => {
		expect(formatLastUpdate(0, 'ro')).toBe('');
	});

	it('formats timestamp in Romanian locale', () => {
		// 2026-02-15 10:30:00 UTC
		const timestamp = new Date('2026-02-15T10:30:00Z').getTime();
		const result = formatLastUpdate(timestamp, 'ro');
		expect(result).toMatch(/feb/i);
		expect(result).toMatch(/2026/);
	});

	it('formats timestamp in English locale', () => {
		const timestamp = new Date('2026-02-15T10:30:00Z').getTime();
		const result = formatLastUpdate(timestamp, 'en');
		expect(result).toMatch(/Feb/);
		expect(result).toMatch(/2026/);
	});

	it('includes time component', () => {
		const timestamp = new Date('2026-02-15T10:30:00Z').getTime();
		const result = formatLastUpdate(timestamp, 'ro');
		// Should contain HH:MM pattern
		expect(result).toMatch(/\d{1,2}:\d{2}/);
	});
});
