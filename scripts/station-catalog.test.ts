import { describe, expect, it } from 'vitest';
import { buildCatalog, parseCsvLine, parseFeedVersion, parseStationLines, parseStations, validateCatalog } from './station-catalog.js';

const header = 'stop_id,stop_name,stop_desc,stop_lat,stop_lon,location_type';
const lineFiles = {
	routes: 'route_id,route_short_name,route_type\nroute-66,66,11',
	trips: 'route_id,trip_id,direction_id\nroute-66,outbound,0',
	stopTimes: 'trip_id,stop_id\noutbound,3570'
};

describe('station catalog generator', () => {
	it('joins exact stops across both directions, preserving type and metro parents', () => {
		const stops = [
			`${header},parent_station`,
			'1008-42,Outbound,,44.42,26.1,,',
			'43,Inbound,,44.42,26.1,,',
			'44,Nearby unserved,,44.42,26.1,,',
			'45,No boarding or alighting,,44.42,26.1,,',
			'14700,Metro,,44.42,26.1,1,',
			'14700T,Metro platform,,44.42,26.1,,14700',
			'PV1_44,Regional ID collision,,44.42,26.1,,'
		].join('\n');
		const files = {
			routes: 'route_id,route_short_name,route_type\nr66,66,11\nrBus,66,3\nrMetro,M1,1',
			trips: 'route_id,trip_id,direction_id\nr66,out,0\nr66,back,1\nrBus,bus,0\nrMetro,metro,0',
			stopTimes: [
				'trip_id,stop_id,pickup_type,drop_off_type',
				'out,1008-42,,',
				'out,1008-42,,',
				'back,43,,',
				'out,45,1,1',
				'bus,43,,',
				'bus,PV1_44,,',
				'metro,14700T,,',
				'unknown,44,,'
			].join('\r\n')
		};
		const membership = parseStationLines(stops, files);
		expect(membership.get(42)).toEqual(['TROLLEYBUS:66']);
		expect(membership.get(43)).toEqual(['BUS:66', 'TROLLEYBUS:66']);
		expect(membership.get(14700)).toEqual(['SUBWAY:M1']);
		expect(membership.has(44)).toBe(false);
		expect(membership.has(45)).toBe(false);
		expect([...membership.keys()]).toHaveLength(3);
	});

	it('rejects missing stop-time join columns', () => {
		expect(() => parseStationLines(header, {
			...lineFiles, stopTimes: 'trip_id,stop_sequence\noutbound,1'
		})).toThrow('Missing required GTFS column: stop_id');
	});

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
		expect(() => buildCatalog(header, 'feed_publisher_name,feed_version\nTPBI,6.38', 'not-a-date', lineFiles)).toThrow(
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
			'Sat, 11 Jul 2026 13:48:53 GMT',
			lineFiles
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

	it('parseStations throws when a required GTFS column is missing', () => {
		const missingDescHeader = 'stop_id,stop_name,stop_lat,stop_lon,location_type';
		expect(() =>
			parseStations([missingDescHeader, '42,Station,,44.42,26.10,'].join('\n'))
		).toThrow(/stop_desc/);
	});

	it('builds and validates a deterministic catalog', () => {
		const rows = Array.from({ length: 2_500 }, (_, index) =>
			`${index + 1},Station ${index + 1},,44.42,26.10,`
		);
		rows.push('3570,Piata Unirii,,44.42658,26.100225,');
		const catalog = buildCatalog(
			[header, ...rows].join('\n'),
			'feed_publisher_name,feed_version\nTPBI,6.38',
			'Sat, 11 Jul 2026 13:48:53 GMT',
			lineFiles
		);

		expect(catalog.feedVersion).toBe('6.38');
		expect(catalog.sourceUpdatedAt).toBe('2026-07-11T13:48:53.000Z');
		expect(catalog.stations).toHaveLength(2_501);
		expect(catalog.stations.find((station) => station.id === 3570)?.lines).toEqual(['TROLLEYBUS:66']);
		expect(catalog.stations.find((station) => station.id === 1)?.lines).toEqual([]);
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

	it('throws on an unterminated quoted CSV field', () => {
		expect(() => parseCsvLine('"abc,def')).toThrow('Unterminated quoted CSV field');
	});
});
