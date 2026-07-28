import { describe, expect, it } from 'vitest';
import { buildCatalog, parseCsvLine, parseFeedVersion, parseStations, validateCatalog } from './station-catalog.js';

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

	it('skips stations with empty names', () => {
		const stations = parseStations([
			header,
			'42,,Extra description,44.42,26.10,',
			'43,Has Name,,44.43,26.11,'
		].join('\n'));

		expect(stations.map((station) => station.id)).toEqual([43]);
	});

	it('deduplicates stations by STB stop ID', () => {
		const stations = parseStations([
			header,
			'42,Duplicate A,,44.42,26.10,',
			'42,Duplicate B,,44.43,26.11,',
			'43,Unique,,44.44,26.12,'
		].join('\n'));

		expect(stations.map((station) => station.id)).toEqual([42, 43]);
		expect(stations.find((s) => s.id === 42)?.name).toBe('Duplicate A');
	});

	it('excludes location_type 4 (entrance only)', () => {
		const stations = parseStations([
			header,
			'42,Regular,,44.42,26.10,',
			'43,Platform,,44.43,26.11,0',
			'44,Entrance,,44.44,26.12,4'
		].join('\n'));

		expect(stations.map((station) => station.id)).toEqual([42, 43]);
	});

	it('buildCatalog throws for invalid timestamps', () => {
		expect(() => buildCatalog(header, 'feed_publisher_name,feed_version\nTPBI,6.38', 'not-a-date')).toThrow(
			'Invalid source update timestamp'
		);
	});

	it('validateCatalog rejects small catalogs', () => {
		const catalog = { feedVersion: '0', sourceUpdatedAt: new Date().toISOString(), stations: [] };
		expect(() => validateCatalog(catalog)).toThrow(/unexpectedly small/);
	});

	it('validateCatalog rejects duplicate station IDs', () => {
		const rows = Array.from({ length: 2_400 }, (_, index) =>
			`${index + 1},Station ${index + 1},,44.42,26.10,`
		);
		rows.push('3570,Piata Unirii,,44.42658,26.100225,');
		const catalog = buildCatalog(
			[header, ...rows].join('\n'),
			'feed_publisher_name,feed_version\nTPBI,6.38',
			'Sat, 11 Jul 2026 13:48:53 GMT'
		);
		catalog.stations.push({ id: 3570, name: 'Duped', description: '', lat: 44.0, lon: 26.0 });

		expect(() => validateCatalog(catalog)).toThrow(/duplicate IDs/);
	});

	it('validateCatalog requires known station Piata Unirii (id=3570)', () => {
		const rows = Array.from({ length: 2_400 }, (_, index) =>
			`${index + 1},Station ${index + 1},,44.42,26.10,`
		);
		const rawStops = [header, ...rows].join('\n');
		const stations = parseStations(rawStops);

		expect(stations.map((s) => s.id)).not.toContain(3570);

		const catalog = { feedVersion: '6.38', sourceUpdatedAt: new Date().toISOString(), stations };
		expect(() => validateCatalog(catalog)).toThrow(/Piata Unirii/);
	});

	it('parseStations sorts output by id ascending', () => {
		const stations = parseStations([
			header,
			'50,Z,,44.42,26.10,',
			'10,A,,44.43,26.11,',
			'90,C,,44.44,26.12,'
		].join('\n'));

		expect(stations.map((s) => s.id)).toEqual([10, 50, 90]);
	});

	it('parseStations throws on empty GTFS input', () => {
		expect(() => parseStations('')).toThrow(/empty/);
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

	it('excludes location_type 2 (platform) with a valid numeric ID', () => {
		const stations = parseStations([
			header,
			'42,Regular,,44.42,26.10,',
			'43,Platform Only,,44.43,26.11,2',
			'44,Another Platform,,44.44,26.12,4'
		].join('\n'));

		expect(stations.map((station) => station.id)).toEqual([42]);
	});

	it('skips stations with non-finite coordinates', () => {
		const stations = parseStations([
			header,
			'42,Valid Station,,44.42,26.10,',
			'43,Nan Lat,,NaN,26.11,',
			'44,Inf Lon,,44.44,Infinity,',
			'45,Empty Lat,,,,'
		].join('\n'));

		expect(stations.map((station) => station.id)).toEqual([42]);
	});

	it('parseFeedVersion throws when feed_version is empty', () => {
		expect(() => parseFeedVersion([
			'feed_publisher_name,feed_version',
			'TPBI,'
		].join('\n'))).toThrow(/empty/);
	});

	it('excludes stations outside Bucharest geographic bounds', () => {
		const stations = parseStations([
			header,
			'42,Inside,,44.42,26.10,',
			'43,North,,45.00,26.10,',
			'44,West,,44.44,25.80,'
		].join('\n'));

		expect(stations.map((station) => station.id)).toEqual([42]);
	});
});
