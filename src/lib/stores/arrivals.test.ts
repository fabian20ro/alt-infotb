import { describe, it, expect } from 'vitest';
import { formatArrivalTime, formatTime } from './arrivals.js';

describe('formatArrivalTime', () => {
	it('returns "acum" for 0 seconds', () => {
		expect(formatArrivalTime(0)).toBe('acum');
	});

	it('returns "acum" for negative seconds', () => {
		expect(formatArrivalTime(-5)).toBe('acum');
	});

	it('returns "1 min" for 1-60 seconds', () => {
		expect(formatArrivalTime(1)).toBe('1 min');
		expect(formatArrivalTime(30)).toBe('1 min');
		expect(formatArrivalTime(60)).toBe('1 min');
	});

	it('rounds up to nearest minute', () => {
		expect(formatArrivalTime(61)).toBe('2 min');
		expect(formatArrivalTime(90)).toBe('2 min');
		expect(formatArrivalTime(120)).toBe('2 min');
	});

	it('handles large values', () => {
		expect(formatArrivalTime(3600)).toBe('60 min');
		expect(formatArrivalTime(7200)).toBe('120 min');
	});
});

describe('formatTime', () => {
	it('formats date to HH:MM', () => {
		const date = new Date('2025-01-15T14:30:00');
		const result = formatTime(date);
		// Result depends on locale, but should contain hour and minute
		expect(result).toMatch(/14[:\.]30/);
	});
});
