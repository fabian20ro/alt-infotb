import { describe, expect, it } from 'vitest';
import { normalizeTransportType } from './transport.ts';

describe('normalizeTransportType', () => {
	it.each(['BUS', 'TRAM', 'TROLLEYBUS', 'SUBWAY'] as const)('preserves %s', (type) => {
		expect(normalizeTransportType(type)).toBe(type);
	});
	it('normalizes the observed STB trolleybus enum', () => {
		expect(normalizeTransportType('CABLE_CAR')).toBe('TROLLEYBUS');
		expect(normalizeTransportType(' cable_car ')).toBe('TROLLEYBUS');
	});
	it.each(['', 'TRAIN', 'FERRY', 'BUS_EXPRESS'])('does not silently accept unknown type %s', (type) => {
		expect(normalizeTransportType(type)).toBeUndefined();
	});
});
