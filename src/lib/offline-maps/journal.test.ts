import { describe, expect, it } from 'vitest';
import { emptyJournal, type Generation, type ManagerConfig } from './contracts.ts';
import { parseJournal } from './journal.ts';

const config: ManagerConfig = { namespace: '/alt-infotb/', regionId: 'bucuresti-ilfov', reader: {
	version: 1, allowedOrigins: ['https://maps.example.test'],
	profiles: [{ renderer: 'maplibre', tileSchema: 'test-v1', style: 'test-v1' }]
} };
function generation(id = 'generation-a'): Generation {
	const base = { bytes: 1, sha256: 'a'.repeat(64) };
	const assets: Generation['manifest']['assets'] = [
		{ ...base, kind: 'glyph', path: 'fonts/font/0-255.pbf' },
		{ ...base, kind: 'license', path: 'license.txt' }
	];
	for (const theme of ['light', 'dark'] as const) {
		assets.push({ ...base, kind: 'style', path: `${theme}.json`, theme });
		for (const density of [1, 2] as const) for (const [kind, extension] of [['sprite-index', '.json'], ['sprite-image', '.png']] as const) {
			assets.push({ ...base, kind, path: `sprites/${theme}${density === 2 ? '@2x' : ''}${extension}`, theme, density });
		}
	}
	return { id, manifestSha256: 'b'.repeat(64), manifest: {
		schemaVersion: 1, regionId: config.regionId, version: '20261106-v1', dataDate: '2026-11-06',
		bounds: [25.8, 44.19, 26.49, 44.8], nativeZoom: { min: 0, max: 15 },
		compatibility: { ...config.reader.profiles[0], minReaderVersion: 1, maxReaderVersion: 1 },
		baseUrl: 'https://maps.example.test/bucuresti-ilfov/20261106-v1/',
		archive: { ...base, path: 'basemap.pmtiles' }, assets, totalBytes: 1 + assets.length,
		attributions: [{ text: 'fixture', url: 'https://maps.example.test/', licensePath: 'license.txt' }]
	} };
}

describe('offline journal recovery boundary', () => {
	it('accepts absent storage and an operation waiting for a bounded manifest', () => {
		expect(parseJournal(undefined, config)).toEqual(emptyJournal());
		const pending = { ...emptyJournal(), operation: { id: 'operation-a', phase: 'downloading' as const, cancelled: true } };
		expect(parseJournal(pending, config)).toEqual(pending);
	});
	it('preserves independent invalid availability, render confirmation and cancellation', () => {
		const source = { ...emptyJournal(), active: generation(), invalidActive: true };
		expect(parseJournal(source, config)).toEqual(source);
		const installing = { ...source, candidate: generation('generation-b'), operation: { id: 'operation-a', phase: 'verifying' as const, cancelled: true } };
		expect(parseJournal(installing, config)).toEqual(installing);
	});
	it('returns owned data, without aliases into persisted manifest objects', () => {
		const source = { ...emptyJournal(), active: generation() };
		const parsed = parseJournal(source, config);
		source.active.manifest.archive.path = 'changed.pmtiles';
		expect(parsed.active!.manifest.archive.path).toBe('basemap.pmtiles');
	});
	for (const [name, change] of [
		['unknown schema', (s: any) => { s.schemaVersion = 2; }],
		['unknown property', (s: any) => { s.deleteEverything = true; }],
		['unsafe generation', (s: any) => { s.active.id = '../another-app'; }],
		['foreign region', (s: any) => { s.active.manifest.regionId = 'another-region'; }],
		['foreign source origin', (s: any) => { s.active.manifest.baseUrl = 'https://evil.example/bucuresti-ilfov/20261106-v1/'; }],
		['duplicate ownership', (s: any) => { s.garbage.push(s.active); }],
		['third physical generation', (s: any) => { s.previous = generation('generation-b'); s.garbage.push(generation('generation-c')); }],
		['verifying without candidate', (s: any) => { s.operation = { id: 'operation-a', phase: 'verifying', cancelled: false }; }],
		['deleting with active pointer', (s: any) => { s.operation = { id: 'operation-a', phase: 'deleting', cancelled: false }; }],
		['candidate without operation', (s: any) => { s.candidate = generation('generation-b'); }],
		['invalid marker without active', (s: any) => { s.active = null; s.invalidActive = true; }],
		['confirmation without active', (s: any) => { s.active = null; s.pendingRender = true; }]
	] as const) it(`rejects ${name} before identifiers reach storage`, () => {
		const state = { ...emptyJournal(), active: generation() };
		change(state); expect(() => parseJournal(state, config)).toThrow(/Invalid offline map/);
	});
	it('rejects null/corrupt records and ambiguous application namespaces', () => {
		expect(() => parseJournal(null, config)).toThrow();
		expect(() => parseJournal(emptyJournal(), { ...config, namespace: '/alt-infotb/../other/' })).toThrow();
		expect(() => parseJournal(emptyJournal(), { ...config, namespace: 'https://other.example/' })).toThrow();
	});
});
