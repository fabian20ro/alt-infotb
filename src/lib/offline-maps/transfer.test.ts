import { describe, expect, it, vi } from 'vitest';
import { createPackageTransport, digestBytes } from './transport';
import type { Generation } from './contracts';
import type { ManifestReader, OfflineMapManifest, PackageAsset } from './manifest';

const reader: ManifestReader = { version: 1, allowedOrigins: ['https://maps.example'],
	profiles: [{ renderer: 'maplibre', tileSchema: 'test-v1', style: 'test-v1' }] };
const encoder = new TextEncoder();
const payload = encoder.encode('immutable regional bytes');
const signal = () => new AbortController().signal;
function fixture() {
	const assets: PackageAsset[] = [
		{ kind: 'glyph', path: 'fonts/Test/0-255.pbf', bytes: 1, sha256: '1'.repeat(64) },
		{ kind: 'license', path: 'license.txt', bytes: 1, sha256: '1'.repeat(64) }
	];
	for (const theme of ['light', 'dark'] as const) {
		assets.push({ kind: 'style', theme, path: `${theme}.json`, bytes: 1, sha256: '1'.repeat(64) });
		for (const density of [1, 2] as const) for (const kind of ['sprite-index', 'sprite-image'] as const) assets.push({
			kind, theme, density, path: `sprites/${theme}${density === 2 ? '@2x' : ''}.${kind === 'sprite-index' ? 'json' : 'png'}`, bytes: 1, sha256: '1'.repeat(64)
		});
	}
	const manifest: OfflineMapManifest = { schemaVersion: 1, regionId: 'region', version: '20261107-v1', dataDate: '2026-11-07',
		bounds: [25, 44, 27, 45], nativeZoom: { min: 0, max: 15 },
		compatibility: { ...reader.profiles[0], minReaderVersion: 1, maxReaderVersion: 1 },
		baseUrl: 'https://maps.example/packages/region/20261107-v1/',
		archive: { path: 'map.pmtiles', bytes: payload.length, sha256: digestBytes(payload) }, assets,
		totalBytes: payload.length + assets.length,
		attributions: [{ text: 'Test data', url: 'https://maps.example/license', licensePath: 'license.txt' }] };
	const bytes = encoder.encode(JSON.stringify(manifest));
	const offer = { manifestUrl: `${manifest.baseUrl}manifest.json`, manifestSha256: digestBytes(bytes) };
	const generation: Generation = { id: 'generation-a', manifest, manifestSha256: offer.manifestSha256 };
	return { manifest, bytes, offer, generation };
}
const fetchFor = (response: () => Response): typeof fetch => vi.fn(async () => response());
async function collect(stream: AsyncIterable<Uint8Array>) {
	const chunks: Uint8Array[] = [];
	for await (const chunk of stream) chunks.push(chunk);
	return Buffer.concat(chunks);
}

describe('trusted package transport', () => {
	it('hash-pins the bounded manifest before parsing and matches its exact immutable location', async () => {
		const f = fixture(); const fetcher = fetchFor(() => new Response(f.bytes));
		const transport = createPackageTransport({ fetch: fetcher });
		expect(await transport.manifest(f.offer, reader, signal())).toEqual(f.manifest);
		expect(fetcher).toHaveBeenCalledWith(f.offer.manifestUrl, expect.objectContaining({ redirect: 'error', credentials: 'omit', cache: 'no-store' }));
		await expect(transport.manifest({ ...f.offer, manifestSha256: '0'.repeat(64) }, reader, signal())).rejects.toThrow('manifest SHA256');
		const moved = { ...f.manifest, baseUrl: 'https://maps.example/elsewhere/region/20261107-v1/' };
		const bytes = encoder.encode(JSON.stringify(moved));
		await expect(createPackageTransport({ fetch: fetchFor(() => new Response(bytes)) }).manifest({ ...f.offer, manifestSha256: digestBytes(bytes) }, reader, signal())).rejects.toThrow('immutable base URL');
	});
	it.each(['http://maps.example/x/manifest.json', 'https://evil.example/x/manifest.json',
		'https://user@maps.example/x/manifest.json', 'https://maps.example/x/manifest.json?secret=x', 'https://maps.example/x/manifest.json#x'])('rejects untrusted offer URL before fetching: %s', async url => {
		const f = fixture(); const fetcher = fetchFor(() => new Response(f.bytes));
		await expect(createPackageTransport({ fetch: fetcher }).manifest({ ...f.offer, manifestUrl: url }, reader, signal())).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
	});
	it('does not parse a corrupted manifest even if it contains invalid JSON', async () => {
		const f = fixture(); const bytes = encoder.encode('{');
		await expect(createPackageTransport({ fetch: fetchFor(() => new Response(bytes)) }).manifest(f.offer, reader, signal())).rejects.toThrow('SHA256 mismatch');
	});
	it('rejects oversized manifests and cancels their body', async () => {
		const f = fixture(); const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel });
		await expect(createPackageTransport({ fetch: fetchFor(() => new Response(stream)) }).manifest(f.offer, reader, signal())).rejects.toThrow('byte limit');
		expect(cancel).toHaveBeenCalled();
	});
	it.each(['partial', 'redirect', 'opaque', 'foreign-url', 'encoding', 'length'])('rejects unsupported %s responses', async kind => {
		const f = fixture(); const response = new Response(f.bytes, { status: kind === 'partial' ? 206 : 200 });
		if (kind === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
		if (kind === 'opaque') Object.defineProperty(response, 'type', { value: 'opaque' });
		if (kind === 'foreign-url') Object.defineProperty(response, 'url', { value: 'https://evil.example/manifest.json' });
		if (kind === 'encoding') response.headers.set('content-encoding', 'gzip');
		if (kind === 'length') response.headers.set('content-length', String(f.bytes.length + 1));
		await expect(createPackageTransport({ fetch: fetchFor(() => response) }).manifest(f.offer, reader, signal())).rejects.toThrow();
	});
	it('streams bytes incrementally and checks the final digest', async () => {
		const f = fixture(); let streamController!: ReadableStreamDefaultController<Uint8Array>;
		const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
		const iterator = createPackageTransport({ fetch: fetchFor(() => new Response(body)) }).file(f.generation, f.manifest.archive, signal())[Symbol.asyncIterator]();
		streamController.enqueue(payload.slice(0, 4));
		expect((await iterator.next()).value).toEqual(payload.slice(0, 4));
		streamController.enqueue(payload.slice(4)); streamController.close();
		expect((await iterator.next()).value).toEqual(payload.slice(4));
		expect((await iterator.next()).done).toBe(true);
	});
	it.each(['short', 'long', 'hash'])('rejects %s file content without accepting a completed file', async failure => {
		const f = fixture();
		const bytes = failure === 'short' ? payload.slice(1) : failure === 'long' ? new Uint8Array(payload.length + 1) : new Uint8Array(payload.length);
		const transport = createPackageTransport({ fetch: fetchFor(() => new Response(bytes)) });
		await expect(collect(transport.file(f.generation, f.manifest.archive, signal()))).rejects.toThrow();
	});
	it('only fetches declared immutable files and cancels when its consumer stops early', async () => {
		const f = fixture(); let requestSignal: AbortSignal | undefined; const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(payload.slice(0, 1)); }, cancel });
		const fetcher: typeof fetch = vi.fn(async (_url, init) => { requestSignal = init?.signal as AbortSignal; return new Response(body); });
		const transport = createPackageTransport({ fetch: fetcher });
		await expect(collect(transport.file(f.generation, { ...f.manifest.archive, path: '../other' }, signal()))).rejects.toThrow('undeclared');
		expect(fetcher).not.toHaveBeenCalled();
		for await (const _chunk of transport.file(f.generation, f.manifest.archive, signal())) break;
		expect(cancel).toHaveBeenCalled(); expect(requestSignal?.aborted).toBe(true);
	});
	it('aborts a stalled body and bounds it by timeout even for a custom transport', async () => {
		const f = fixture(); const controller = new AbortController(); const cancel = vi.fn();
		const stalled = () => new Response(new ReadableStream<Uint8Array>({ cancel }));
		const waiting = collect(createPackageTransport({ fetch: fetchFor(stalled) }).file(f.generation, f.manifest.archive, controller.signal));
		controller.abort(new DOMException('User cancelled', 'AbortError'));
		await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
		await expect(collect(createPackageTransport({ fetch: fetchFor(stalled), timeoutMs: 10 }).file(f.generation, f.manifest.archive, signal()))).rejects.toMatchObject({ name: 'TimeoutError' });
		expect(cancel).toHaveBeenCalled();
	});
	it('bounds stalled response headers and disposes a response arriving after cancellation', async () => {
		const f = fixture(); let resolveFetch!: (response: Response) => void;
		const fetcher: typeof fetch = () => new Promise(resolve => { resolveFetch = resolve; });
		await expect(createPackageTransport({ fetch: fetcher, timeoutMs: 10 }).manifest(f.offer, reader, signal())).rejects.toMatchObject({ name: 'TimeoutError' });
		const cancel = vi.fn();
		resolveFetch(new Response(new ReadableStream({ cancel })));
		await Promise.resolve(); await Promise.resolve();
		expect(cancel).toHaveBeenCalled();
	});
});
