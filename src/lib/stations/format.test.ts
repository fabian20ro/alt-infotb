import { describe, it, expect } from 'vitest';
import { formatLastUpdate } from './format.js';

describe('formatLastUpdate', () => {
	it('returns empty string when timestamp is 0', () => {
		expect(formatLastUpdate(0, 'ro')).toBe('');
	});

	it('returns empty string for null or undefined', ()	=> {
		expect(formatLastUpdate(null as any, 'ro')).toBe('');
		expect(formatLastUpdate(undefined as any, 'en')).toBe('');
	});

	it('returns empty string for invalid date', () => {
		expect(formatLastUpdate(NaN, 'ro')).toBe('');
	});

	it('formats timestamp in Romanian locale', () => {
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
});
