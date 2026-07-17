import { describe, it, expect, vi } from 'vitest';
import { formatLastUpdate } from './format.js';

const FIXED_NOW = 1_750_000_000_000; // 2025-06-15T14:13:20.000Z (non-leap-ish epoch)
// Use vi.useFakeTimers in tests that assert boundary behavior, so Date.now() drift does not flake the <60s threshold.

describe('formatLastUpdate', () => {
	it('formats date in English with AM/PM time', () => {
		const ts = new Date('2026-06-11T10:11:00Z').getTime();
		const formatted = formatLastUpdate(ts, 'en');
		expect(formatted).toContain('Jun 11, 2026');
		expect(formatted).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
	});

	it('formats date in Romanian with abbreviated month and period', () => {
		const ts = new Date('2026-06-11T10:11:00Z').getTime();
		const formatted = formatLastUpdate(ts, 'ro');
		expect(formatted).toContain('11');
		expect(formatted).toMatch(/iun\./);
		expect(formatted).toContain('2026');
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

	it('returns "Just now" for very recent timestamps', () => {
		const ts = Date.now() - 30000; // 30 seconds ago
		expect(formatLastUpdate(ts, 'en')).toBe('Just now');
		expect(formatLastUpdate(ts, 'ro')).toBe('Acum');
	});

	it('formats future timestamps with Intl date format (not "Just now")', () => {
		const future = Date.now() + 5 * 60 * 1000; // 5 minutes from now
		const formattedEn = formatLastUpdate(future, 'en');
		const formattedRo = formatLastUpdate(future, 'ro');
		expect(formattedEn).not.toBe('Just now');
		expect(formattedEn).not.toBe('');
		expect(formattedRo).not.toBe('Acum');
		expect(formattedRo).not.toBe('');
	});

	it('formats timestamps more than 60 seconds ago as date, not "Just now"', () => {
		const past = Date.now() - 120_000; // 2 minutes ago
		expect(formatLastUpdate(past, 'en')).not.toBe('Just now');
		expect(formatLastUpdate(past, 'ro')).not.toBe('Acum');
	});

	it('respects the 60-second boundary for "now" detection', () => {
		const justUnder = Date.now() - 59_000; // ~59s ago — still within threshold
		expect(formatLastUpdate(justUnder, 'en')).toBe('Just now');
		expect(formatLastUpdate(justUnder, 'ro')).toBe('Acum');

		const justOver = Date.now() - 61_000; // ~61s ago — past threshold
		expect(formatLastUpdate(justOver, 'en')).not.toBe('Just now');
		expect(formatLastUpdate(justOver, 'ro')).not.toBe('Acum');
	});

	it('treats exactly 60 seconds as outside "now" threshold', () => {
		const boundary = Date.now() - 60_000; // exactly 60s ago
		expect(formatLastUpdate(boundary, 'en')).not.toBe('Just now');
		expect(formatLastUpdate(boundary, 'ro')).not.toBe('Acum');
		expect(formatLastUpdate(boundary, 'en')).not.toBe('');
	});

	it('treats timestamp at exactly now as "Just now"', () => {
		const ts = Date.now(); // diffSeconds === 0
		expect(formatLastUpdate(ts, 'en')).toBe('Just now');
		expect(formatLastUpdate(ts, 'ro')).toBe('Acum');
	});

	it('treats sub-second boundary (59.5s ago) as "Just now"', () => {
		const ts = Date.now() - 59_500; // diffSeconds ≈ 59.5 — still < 60
		expect(formatLastUpdate(ts, 'en')).toBe('Just now');
		expect(formatLastUpdate(ts, 'ro')).toBe('Acum');
	});

	it('treats sub-second boundary (60.1s ago) as relative time, not "Just now"', () => {
		const ts = Date.now() - 60_100; // ~60.1s ago — past < 60 threshold
		expect(formatLastUpdate(ts, 'en')).not.toBe('Just now');
		expect(formatLastUpdate(ts, 'ro')).not.toBe('Acum');
	});

	it('handles timestamp from the distant past without falling into "now"', () => {
		const old = new Date('2020-01-01T00:00:00Z').getTime();
		expect(formatLastUpdate(old, 'en')).not.toBe('Just now');
		expect(formatLastUpdate(old, 'ro')).not.toBe('Acum');
		expect(formatLastUpdate(old, 'en')).not.toBe('');
	});

	it('formats future timestamps with positive assertions', () => {
		const future = Date.now() + 5 * 60 * 1000; // 5 minutes in the future
		const formattedEn = formatLastUpdate(future, 'en');
		expect(formattedEn).not.toBe('Just now');
		expect(formattedEn).not.toBe('');
		// Future timestamps should produce a valid date string with year component
		expect(formattedEn).toMatch(/\d{4}/);
	});

	it('handles negative diffSeconds (future) without falling into "now"', () => {
		const future = Date.now() + 30 * 1000; // 30s in the future
		// diffSeconds would be -30, failing the >= 0 guard → falls through to Intl formatting
		expect(formatLastUpdate(future, 'en')).not.toBe('Just now');
		expect(formatLastUpdate(future, 'ro')).not.toBe('Acum');
	});

	it('formats minutes-ago relative time in English', () => {
		const ts = Date.now() - 5 * 60 * 1000; // 5 minutes ago
		expect(formatLastUpdate(ts, 'en')).toBe('5 minutes ago');
	});

	it('formats minutes-ago relative time in Romanian', () => {
		const ts = Date.now() - 5 * 60 * 1000; // 5 minutes ago
		expect(formatLastUpdate(ts, 'ro')).toBe('5 min');
	});

	it('formats hours-ago relative time in English', () => {
		const ts = Date.now() - 3 * 3600 * 1000; // 3 hours ago
		expect(formatLastUpdate(ts, 'en')).toBe('3 hours ago');
	});

	it('formats hours-ago relative time in Romanian', () => {
		const ts = Date.now() - 3 * 3600 * 1000; // 3 hours ago
		expect(formatLastUpdate(ts, 'ro')).toBe('3 h');
	});

	it('formats days-ago relative time in English', () => {
		const ts = Date.now() - 5 * 24 * 3600 * 1000; // 5 days ago
		expect(formatLastUpdate(ts, 'en')).toBe('5 days ago');
	});

	it('formats days-ago relative time in Romanian', () => {
		const ts = Date.now() - 5 * 24 * 3600 * 1000; // 5 days ago
		expect(formatLastUpdate(ts, 'ro')).toBe('5 z');
	});

	it('falls back to full date for timestamps older than ~7 days', () => {
		const old = new Date('2020-06-11T10:00:00Z').getTime();
		const formattedEn = formatLastUpdate(old, 'en');
		expect(formattedEn).toMatch(/\d{4}/);
	});

	it('formats near-future timestamps as empty string', () => {
		const future = Date.now() + 30 * 1000; // 30s in the future
		expect(formatLastUpdate(future, 'en')).toBe('');
	});
});
