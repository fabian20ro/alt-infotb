import { describe, expect, it } from 'vitest';
import { buildCatalog, parseCsvLine, parseFeedVersion, parseStations } from './station-catalog.js';

const header = 'stop_id,stop_name,stop_desc,stop_lat,stop_lon,location_type';

describe('station catalog generator', () => {
	it('parses quoted CSV fields and escaped quotes', () => {
		expect(parseCsvLine('42,"Piața, Centrală","Peron ""nou"""')).toEqual([
			'42',
			'Piața, Centrală',
			'Peron "nou"'
		]);
	});

	it('accepts current numeric and legacy 1008-prefixed STB IDs', () => {
		const stations = parseStations([
			header,
			'42,Numeric,,44.42,26.10,',
			'1008-43,Legacy,,44.43,26.11,',
			'PV1_44,Regional,,44.44,26.12,',
			'45,Entrance,,44.45,26.13,2',
			'46,Outside,,44.45,25.80,'
		].join('\n'));

		expect(stations.map((station) => station.id)).toEqual([42, 43]);
	});

	it('reads the TPBI feed version', () => {
		expect(parseFeedVersion([
			'feed_publisher_name,feed_version',
			'TPBI,6.38'
		].join('\n'))).toBe('6.38');
	});

	it('builds and validates a deterministic catalog', () => {
		const rows = Array.from({ length: 2_500 }, (_, index) =>
			`${index + 1},Station ${index + 1},,44.42,26.10,`
		);
		rows.push('3570,Piata Unirii,,44.42658,26.100225,');
		const catalog = buildCatalog(
			[header, ...rows].join('\n'),
			'feed_publisher_name,feed_version\nTPBI,6.38',
			'Sat, 11 Jul 2026 13:48:53 GMT'
		);

		expect(catalog.feedVersion).toBe('6.38');
		expect(catalog.sourceUpdatedAt).toBe('2026-07-11T13:48:53.000Z');
		expect(catalog.stations).toHaveLength(2_501);
	});
});
