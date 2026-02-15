import { describe, it, expect } from 'vitest';
import { formatArrivalTime, formatTime } from './arrivals.svelte.js';

describe('formatArrivalTime', () => {
	it('returns "acum" for 0 seconds', () => {
		expect(formatArrivalTime(0)).toBe('acum');
	});

	it('returns "acum" for negative seconds', () => {
		expect(formatArrivalTime(-5)).toBe('acum');
	});

	it('returns "acum" for values under 30 seconds', () => {
		expect(formatArrivalTime(1)).toBe('acum');
		expect(formatArrivalTime(15)).toBe('acum');
		expect(formatArrivalTime(29)).toBe('acum');
	});

	it('returns "1 min" for 30-60 seconds', () => {
		expect(formatArrivalTime(30)).toBe('1 min');
		expect(formatArrivalTime(60)).toBe('1 min');
	});

	it('rounds up to nearest minute', () => {
		expect(formatArrivalTime(61)).toBe('2 min');
		expect(formatArrivalTime(90)).toBe('2 min');
		expect(formatArrivalTime(120)).toBe('2 min');
	});

	it('formats minutes up to 59', () => {
		expect(formatArrivalTime(3540)).toBe('59 min');
	});

	it('formats exactly 1 hour', () => {
		expect(formatArrivalTime(3600)).toBe('1 oră');
	});

	it('formats 1 hour with minutes using singular "oră"', () => {
		expect(formatArrivalTime(3660)).toBe('1 oră, 1 min');
		expect(formatArrivalTime(6000)).toBe('1 oră, 40 min');
	});

	it('formats 2+ hours with minutes using plural "ore"', () => {
		expect(formatArrivalTime(7200)).toBe('2 ore');
		expect(formatArrivalTime(7260)).toBe('2 ore, 1 min');
		expect(formatArrivalTime(8100)).toBe('2 ore, 15 min');
	});

	it('handles real-world values from proto dump', () => {
		// From actual STB API: line 7 → C.F.R. Progresul
		expect(formatArrivalTime(120)).toBe('2 min');
		expect(formatArrivalTime(1080)).toBe('18 min');
		expect(formatArrivalTime(1680)).toBe('28 min');

		// From actual STB API: line 27 → Faur
		expect(formatArrivalTime(480)).toBe('8 min');
		expect(formatArrivalTime(1560)).toBe('26 min');
		expect(formatArrivalTime(2280)).toBe('38 min');
	});
});

describe('formatTime', () => {
	it('formats date to HH:MM', () => {
		const date = new Date('2025-01-15T14:30:00');
		const result = formatTime(date);
		expect(result).toMatch(/14[:\.]30/);
	});
});
