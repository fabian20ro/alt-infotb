import { describe, expect, it } from 'vitest';
import { parseOfflineMapManifest, type ManifestReader } from './manifest.js';

const reader: ManifestReader = {
	version: 1,
	allowedOrigins: ['https://maps.example.test'],
	profiles: [{ renderer: 'maplibre', tileSchema: 'protomaps/4.15.2', style: 'protomaps/5.7.2' }]
};

// Small but complete descriptor fixture. Payload hashes/content are verified at installation.
function manifest() {
	const asset = (kind: string, path: string, extra = {}) => ({
		kind, path, bytes: 10, sha256: 'a'.repeat(64), ...extra
	});
	const assets = [
		asset('glyph', 'fonts/Noto%20Sans%20Regular/0-255.pbf'),
		asset('license', 'licenses/map.txt'),
		...(['light', 'dark'] as const).flatMap(theme => [
			asset('style', `styles/${theme}.json`, { theme }),
			...([1, 2] as const).flatMap(density => {
				const stem = `sprites/${theme}${density === 2 ? '@2x' : ''}`;
				return [
					asset('sprite-index', `${stem}.json`, { theme, density }),
					asset('sprite-image', `${stem}.png`, { theme, density })
				];
			})
		])
	];
	return {
		schemaVersion: 1,
		regionId: 'bucuresti-ilfov',
		version: '2026-11-06-r1',
		dataDate: '2026-11-06',
		bounds: [25.8, 44.19, 26.49, 44.8],
		nativeZoom: { min: 0, max: 15 },
		compatibility: { minReaderVersion: 1, maxReaderVersion: 1, ...reader.profiles[0] },
		baseUrl: 'https://maps.example.test/bucuresti-ilfov/2026-11-06-r1/',
		archive: { path: 'map.pmtiles', bytes: 1000, sha256: 'b'.repeat(64) },
		assets,
		totalBytes: 1120,
		attributions: [{ text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licensePath: 'licenses/map.txt' }]
	};
}

describe('offline map manifest boundary', () => {
	it('accepts a complete versioned regional package independently of the renderer and storage', () => {
		const source = manifest();
		const parsed = parseOfflineMapManifest(source, reader);
		expect(parsed).toEqual(source);
		expect(parsed.assets.find(asset => asset.path === 'sprites/dark@2x.png')).toMatchObject({
			kind: 'sprite-image', theme: 'dark', density: 2
		});
	});

	it('returns an owned descriptor, not mutable references into untrusted input', () => {
		const source = manifest();
		const parsed = parseOfflineMapManifest(source, reader);
		source.bounds[0] = -180;
		source.archive.path = 'replacement.pmtiles';
		source.assets[0].path = 'replacement.pbf';
		source.attributions[0].licensePath = 'replacement.txt';
		expect(parsed.bounds[0]).toBe(25.8);
		expect(parsed.archive.path).toBe('map.pmtiles');
		expect(parsed.assets[0].path).toBe('fonts/Noto%20Sans%20Regular/0-255.pbf');
		expect(parsed.attributions[0].licensePath).toBe('licenses/map.txt');
	});

	it.each([
		['schemaVersion', 2], ['regionId', '../bucuresti'], ['version', 'latest'],
		['dataDate', '2026-02-30'], ['dataDate', '2026-11-06T00:00:00Z'],
		['bounds', [26.49, 44.19, 25.8, 44.8]], ['bounds', [25.8, 44.8, 26.49, 44.19]],
		['bounds', [25.8, 44.19, 26.49, 90]], ['bounds', [25.8, NaN, 26.49, 44.8]],
		['bounds', [25.8, 44.19, 26.49]], ['bounds', Array(4)],
		['nativeZoom', { min: 16, max: 15 }], ['nativeZoom', { min: 0, max: 25 }],
		['nativeZoom', { min: 0, max: 15.5 }], ['totalBytes', 1119],
		['totalBytes', Infinity], ['totalBytes', 0],
		['assets', []], ['assets', Array(12)], ['assets', Array(4097).fill(null)], ['attributions', []],
		['workerUrl', 'https://maps.example.test/worker.js']
	] as [string, unknown][])('rejects invalid %s metadata (%j)', (key, value) => {
		expect(() => parseOfflineMapManifest({ ...manifest(), [key]: value }, reader))
			.toThrow('Invalid offline map manifest');
	});

	it.each([null, [], 'manifest', 7])('rejects non-object manifests (%j)', value => {
		expect(() => parseOfflineMapManifest(value, reader)).toThrow('manifest');
	});

	it.each([
		{ minReaderVersion: 2, maxReaderVersion: 3 },
		{ minReaderVersion: 1, maxReaderVersion: 0 },
		{ renderer: 'leaflet' }, { tileSchema: 'protomaps/5.0.0' }, { style: 'protomaps/6.0.0' }
	])('rejects unsupported reader/schema/style compatibility (%j)', change => {
		const source = manifest();
		expect(() => parseOfflineMapManifest({ ...source, compatibility: { ...source.compatibility, ...change } }, reader))
			.toThrow('compatibility');
	});

	it('compares reader protocol and profile together rather than accepting arbitrary versions', () => {
		const source = manifest();
		source.compatibility.maxReaderVersion = 3;
		expect(parseOfflineMapManifest(source, { ...reader, version: 2 }).compatibility.maxReaderVersion).toBe(3);
		expect(() => parseOfflineMapManifest(source, { ...reader, version: 4 })).toThrow('reader version');
		expect(() => parseOfflineMapManifest(source, { ...reader, profiles: [] })).toThrow('unsupported profile');
	});

	it.each([
		'http://maps.example.test/bucuresti-ilfov/2026-11-06-r1/',
		'https://evil.example.test/bucuresti-ilfov/2026-11-06-r1/',
		'https://maps.example.test.evil.test/bucuresti-ilfov/2026-11-06-r1/',
		'https://user:pass@maps.example.test/bucuresti-ilfov/2026-11-06-r1/',
		'https://maps.example.test/bucuresti-ilfov/latest/',
		'https://maps.example.test/bucuresti-ilfov/2026-11-06-r1/?token=secret',
		'https://maps.example.test/bucuresti-ilfov/2026-11-06-r1/#fragment',
		'https://maps.example.test/%2f/bucuresti-ilfov/2026-11-06-r1/',
		'https://maps.example.test/../bucuresti-ilfov/2026-11-06-r1/'
	])('rejects unsafe or mutable distribution location %s', baseUrl => {
		expect(() => parseOfflineMapManifest({ ...manifest(), baseUrl }, reader)).toThrow('baseUrl');
	});

	it.each([
		'../map.pmtiles', '/map.pmtiles', 'a//map.pmtiles', 'a/./map.pmtiles',
		'a/%2e%2e/map.pmtiles', 'a%2Fmap.pmtiles', 'a\\map.pmtiles',
		'map.pmtiles?token=x', 'map.pmtiles#x', 'https://evil.test/map.pmtiles',
		'map.js', 'map%40.pmtiles'
	])('rejects noncanonical archive paths %s', path => {
		const source = manifest();
		source.archive.path = path;
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('archive.path');
	});

	it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid archive sizes %s', bytes => {
		const source = manifest();
		source.archive.bytes = bytes;
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('archive.bytes');
	});

	it.each(['a'.repeat(63), 'g'.repeat(64), 'A'.repeat(64)])('requires canonical SHA256 (%s)', sha256 => {
		const source = manifest();
		source.archive.sha256 = sha256;
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('sha256');
	});

	it('rejects duplicate files before ambiguous cache keys can be installed', () => {
		const source = manifest();
		source.assets.push(source.assets[0]);
		source.totalBytes += 10;
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('duplicate path');
	});

	it.each(['style', 'sprite-image', 'sprite-index', 'glyph'])('requires complete declared %s resources', kind => {
		const source = manifest();
		const index = source.assets.findIndex(asset => asset.kind === kind);
		source.assets.splice(index, 1);
		source.totalBytes -= 10;
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('assets');
	});

	it('requires sprite index/image pairs and literal @2x names', () => {
		const source = manifest();
		source.assets.find(asset => asset.path === 'sprites/dark@2x.png')!.path = 'sprites/dark%402x.png';
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('path');
		source.assets.find(asset => asset.path === 'sprites/dark%402x.png')!.path = 'sprites/other@2x.png';
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('sprite index/image paths');
	});

	it('rejects executable asset kinds and unrecognized worker fields', () => {
		const source = manifest();
		source.assets[0] = { ...source.assets[0], kind: 'worker', path: 'worker.js' };
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('kind');
		expect(() => parseOfflineMapManifest({ ...manifest(), compatibility: { ...manifest().compatibility, workerUrl: 'worker.js' } }, reader))
			.toThrow('unknown field');
	});

	it('requires local license files and safe attribution links', () => {
		const source = manifest();
		source.attributions[0].licensePath = 'licenses/absent.txt';
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('licensePath');
		source.attributions[0].licensePath = 'licenses/map.txt';
		source.attributions[0].url = 'javascript:alert(1)';
		expect(() => parseOfflineMapManifest(source, reader)).toThrow('url');
	});

});
