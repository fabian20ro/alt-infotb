import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddProtocolAction } from 'maplibre-gl';
import type { OfflineMapManifest } from '../offline-maps/manifest.js';
import type { ReaderLease } from '../offline-maps/contracts.js';
import { PMTILES_PROFILE } from '../offline-maps/profile.js';
import { createPmtilesSource } from './pmtiles-source.js';

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, AddProtocolAction>(),
	header: vi.fn(), tile: vi.fn()
}));
vi.mock('maplibre-gl', () => ({
	addProtocol: (name: string, handler: AddProtocolAction) => mocks.handlers.set(name, handler),
	removeProtocol: (name: string) => mocks.handlers.delete(name)
}));
vi.mock('pmtiles', () => ({
	TileType: { Mvt: 1 },
	FileSource: class { constructor(readonly file: File) {} },
	PMTiles: class { getHeader = mocks.header; getZxy = mocks.tile; }
}));

function gate<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
function fixture() {
	const styles = {
		light: { version: 8, glyphs: 'fonts/{fontstack}/{range}.pbf', sprite: 'sprites/light',
			sources: { basemap: { type: 'vector', url: 'pmtiles://map.pmtiles' } },
			layers: [{ id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water' }] },
		dark: { version: 8, glyphs: 'fonts/{fontstack}/{range}.pbf', sprite: 'sprites/dark',
			sources: { basemap: { type: 'vector', url: 'pmtiles://map.pmtiles' } },
			layers: [{ id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water' }] }
	};
	const manifest: OfflineMapManifest = {
		schemaVersion: 1, regionId: 'bucuresti-ilfov', version: '20261106-v1', dataDate: '2026-11-06',
		bounds: [25.8, 44.19, 26.49, 44.8], nativeZoom: { min: 0, max: 15 },
		compatibility: { ...PMTILES_PROFILE, minReaderVersion: 1, maxReaderVersion: 1 },
		baseUrl: 'https://maps.example/bucuresti-ilfov/20261106-v1/',
		archive: { path: 'map.pmtiles', bytes: 10, sha256: 'a'.repeat(64) },
		assets: [
			{ path: 'light.json', kind: 'style', theme: 'light', bytes: 10, sha256: 'b'.repeat(64) },
			{ path: 'dark.json', kind: 'style', theme: 'dark', bytes: 10, sha256: 'b'.repeat(64) },
			{ path: 'fonts/Noto%20Sans%20Regular/0-255.pbf', kind: 'glyph', bytes: 1, sha256: 'b'.repeat(64) },
			{ path: 'sprites/light@2x.json', kind: 'sprite-index', theme: 'light', density: 2, bytes: 2, sha256: 'c'.repeat(64) }
		], totalBytes: 33, attributions: [{ text: 'OSM <contributors>', url: 'https://www.openstreetmap.org/copyright', licensePath: 'license.txt' }]
	};
	const reader: ReaderLease = {
		generation: { id: 'same-generation', manifest, manifestSha256: 'd'.repeat(64) },
		archive: vi.fn(async () => new Blob(['archive'])),
		asset: vi.fn(async (path: string) => {
			if (path === 'light.json' || path === 'dark.json') return new Blob([JSON.stringify(styles[path.startsWith('light') ? 'light' : 'dark'])]);
			if (path === 'sprites/light@2x.json') return new Blob(['{}']);
			return new Blob([new Uint8Array([42])]);
		}),
		close: vi.fn(async () => {})
	};
	const callbacks = { confirmRendered: vi.fn(async () => true), rejectRendered: vi.fn(async () => true) };
	const source = createPmtilesSource(reader, callbacks);
	return { source, reader, callbacks, styles, manifest };
}
function handler(url: string) { return mocks.handlers.get(new URL(url).protocol.slice(0, -1))!; }
function load(url: string, type: 'arrayBuffer' | 'json' = 'arrayBuffer', controller = new AbortController()) {
	return handler(url)({ url, type }, controller);
}
beforeEach(() => {
	mocks.handlers.clear(); mocks.header.mockReset(); mocks.tile.mockReset();
	mocks.header.mockResolvedValue({ specVersion: 3, tileType: 1, minZoom: 0, maxZoom: 15,
		minLon: 25.8, minLat: 44.19, maxLon: 26.49, maxLat: 44.8 });
	mocks.tile.mockResolvedValue({ data: new Uint8Array([1, 2]).buffer });
});

describe('immutable PMTiles renderer source', () => {
	it('rewrites both themes to one leased local archive and only declared assets', async () => {
		const { source, reader } = fixture();
		const light = await source.style('light'), dark = await source.style('dark');
		const basemap = light.sources.basemap;
		expect(basemap.type).toBe('vector');
		if (basemap.type !== 'vector') throw Error('vector expected');
		expect(basemap).toMatchObject({ minzoom: 0, maxzoom: 15, bounds: [25.8, 44.19, 26.49, 44.8] });
		expect(basemap.attribution).toContain('OSM &lt;contributors&gt;');
		expect(dark.sprite).toBe(String(light.sprite).replace('/light', '/dark'));
		const tileUrl = basemap.tiles![0].replace('{z}', '15').replace('{x}', '1').replace('{y}', '2');
		expect(new Uint8Array((await load(tileUrl)).data as ArrayBuffer)).toEqual(new Uint8Array([1, 2]));
		const glyphUrl = light.glyphs!.replace('{fontstack}', 'Noto Sans Regular').replace('{range}', '0-255');
		expect(new Uint8Array((await load(glyphUrl)).data as ArrayBuffer)).toEqual(new Uint8Array([42]));
		expect(reader.asset).toHaveBeenCalledWith('fonts/Noto%20Sans%20Regular/0-255.pbf');
		expect((await load(`${light.sprite}@2x.json`, 'json')).data).toEqual({});
		await expect(load(`${light.sprite}/../../secret.json`)).rejects.toThrow('undeclared');
		await expect(load(`${tileUrl}?url=https://evil.example`)).rejects.toThrow('unknown resource URL');
		expect(reader.archive).toHaveBeenCalledTimes(1);
		await source.close();
	});

	it('isolates simultaneous maps of the same generation and never removes another protocol', async () => {
		const a = fixture(), b = fixture();
		const sa = await a.source.style('light'), sb = await b.source.style('light');
		expect(sa.glyphs).not.toBe(sb.glyphs);
		await a.source.close(); await a.source.close();
		expect(a.reader.close).toHaveBeenCalledTimes(1); expect(mocks.handlers.size).toBe(1);
		const url = sb.glyphs!.replace('{fontstack}', 'Noto Sans Regular').replace('{range}', '0-255');
		expect((await load(url)).data).toBeInstanceOf(ArrayBuffer);
		await b.source.close(); expect(mocks.handlers.size).toBe(0);
	});

	it('keeps the reader leased until outstanding tile reads settle after destruction', async () => {
		const { source, reader, callbacks } = fixture();
		const style = await source.style('light');
		const sourceSpec = style.sources.basemap;
		if (sourceSpec.type !== 'vector') throw Error('vector expected');
		const pending = gate<{ data: ArrayBuffer }>(); mocks.tile.mockReturnValue(pending.promise);
		const request = load(sourceSpec.tiles![0].replace('{z}', '0').replace('{x}', '0').replace('{y}', '0'));
		const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
		await vi.waitFor(() => expect(mocks.tile).toHaveBeenCalledTimes(1));
		const closing = source.close();
		expect(reader.close).not.toHaveBeenCalled();
		await expect(source.rendered()).rejects.toMatchObject({ name: 'AbortError' });
		expect(callbacks.confirmRendered).not.toHaveBeenCalled();
		pending.resolve({ data: new ArrayBuffer(0) });
		await rejected; await closing;
		expect(reader.close).toHaveBeenCalledTimes(1);
	});

	it('cancels a request without closing a source used by the remaining tiles', async () => {
		const { source, reader } = fixture(), style = await source.style('light');
		const controller = new AbortController(); controller.abort();
		const url = `${style.sprite}@2x.json`;
		await expect(load(url, 'json', controller)).rejects.toMatchObject({ name: 'AbortError' });
		expect(reader.close).not.toHaveBeenCalled();
		expect((await load(url, 'json')).data).toEqual({});
		await source.close();
	});

	it('confirms only the first rendered frame and retains confirmed data after later errors', async () => {
		const { source, callbacks } = fixture();
		await source.style('light'); await source.rendered(); await source.rendered();
		await source.failed(new Error('context lost later'));
		expect(callbacks.confirmRendered).toHaveBeenCalledExactlyOnceWith('same-generation');
		expect(callbacks.rejectRendered).not.toHaveBeenCalled();
		await expect(source.rendered()).rejects.toThrow('first render failed');
		await source.close();
	});

	it('rejects a failed first frame only once and ignores a later stale idle callback', async () => {
		const { source, callbacks } = fixture();
		await source.failed(new Error('bad glyph')); await source.failed(new Error('bad tile'));
		await expect(source.rendered()).rejects.toThrow('first render failed');
		expect(callbacks.rejectRendered).toHaveBeenCalledExactlyOnceWith('same-generation');
		expect(callbacks.confirmRendered).not.toHaveBeenCalled();
		await source.close();
	});

	it('does not confirm a map when its activation acknowledgement is rejected', async () => {
		const { source, callbacks } = fixture();
		callbacks.confirmRendered.mockResolvedValue(false);
		await source.style('light');
		await expect(source.rendered()).rejects.toThrow('render confirmation rejected');
		await expect(source.rendered()).rejects.toThrow('first render failed');
		expect(callbacks.confirmRendered).toHaveBeenCalledTimes(1);
		expect(callbacks.rejectRendered).toHaveBeenCalledExactlyOnceWith('same-generation');
		await source.close();
	});

	for (const mutation of ['glyphs', 'source', 'tiles', 'font-faces', 'profile', 'header'] as const) {
		it(`rejects ${mutation} incompatibility without a network fallback and retains the lease until map destruction`, async () => {
			const { source, styles, reader, callbacks, manifest } = fixture();
			if (mutation === 'glyphs') styles.light.glyphs = 'https://external.example/{fontstack}/{range}.pbf';
			if (mutation === 'source') styles.light.sources.basemap.url = 'https://external.example/source.json';
			if (mutation === 'tiles') Object.assign(styles.light.sources.basemap, { tiles: ['https://external.example/{z}/{x}/{y}.pbf'] });
			if (mutation === 'font-faces') Object.assign(styles.light, { 'font-faces': { Other: [{ url: 'https://external.example/font.ttf' }] } });
			if (mutation === 'profile') manifest.compatibility.style = 'unexpected-v2';
			if (mutation === 'header') mocks.header.mockResolvedValue({ specVersion: 2 });
			await expect(source.style('light')).rejects.toThrow('Offline basemap:');
			expect(callbacks.rejectRendered).toHaveBeenCalledTimes(1);
			expect(reader.close).not.toHaveBeenCalled();
			await source.close(); expect(reader.close).toHaveBeenCalledTimes(1); expect(mocks.handlers.size).toBe(0);
		});
	}

	it('closing while style initialization waits prevents late activation and releases exactly once', async () => {
		const { source, reader, callbacks } = fixture(), pending = gate<Blob>();
		vi.mocked(reader.asset).mockReturnValue(pending.promise);
		const style = source.style('light'), failed = expect(style).rejects.toMatchObject({ name: 'AbortError' });
		const closing = source.close(); expect(reader.close).not.toHaveBeenCalled();
		pending.resolve(new Blob(['{}'])); await failed; await closing;
		expect(reader.close).toHaveBeenCalledTimes(1); expect(callbacks.confirmRendered).not.toHaveBeenCalled();
		expect(callbacks.rejectRendered).not.toHaveBeenCalled();
	});

	it('retains a confirmed package when the renderer fails while its proven first-frame acknowledgement waits', async () => {
		const { source, callbacks } = fixture(), ack = gate<boolean>();
		callbacks.confirmRendered.mockReturnValue(ack.promise);
		await source.style('light');
		const confirmation = source.rendered(), rejected = expect(confirmation).rejects.toThrow('renderer failed after its first frame');
		await source.failed(new Error('context loss after idle'));
		ack.resolve(true); await rejected;
		expect(callbacks.rejectRendered).not.toHaveBeenCalled();
		await expect(source.style('dark')).rejects.toThrow('source failed');
		await source.close();
	});

	it('waits for pending acknowledgement during close and never resolves rendered after destruction', async () => {
		const { source, reader, callbacks } = fixture(), ack = gate<boolean>();
		callbacks.confirmRendered.mockReturnValue(ack.promise);
		await source.style('light');
		const confirmation = source.rendered(), rejected = expect(confirmation).rejects.toMatchObject({ name: 'AbortError' });
		const closing = source.close(); expect(reader.close).not.toHaveBeenCalled();
		ack.resolve(true); await rejected; await closing;
		expect(reader.close).toHaveBeenCalledTimes(1); expect(callbacks.rejectRendered).not.toHaveBeenCalled();
	});
});
