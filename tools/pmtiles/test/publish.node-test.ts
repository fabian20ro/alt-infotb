import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ManifestReader, OfflineMapManifest, PackageAsset } from '../../../src/lib/offline-maps/manifest.ts';
import { publishPackage, PreconditionFailed, type BrowserReceipt, type ObjectMetadata, type ObjectStore, type WriteCondition } from '../src/publish.ts';
import { readBounded, sha256, verifyBody, type Fetcher } from '../src/httpverify.ts';

const revision = 'a'.repeat(40);
const origin = 'https://maps.example';
const reader: ManifestReader = { version: 1, allowedOrigins: [origin], profiles: [{ renderer: 'maplibre', tileSchema: 'test-v1', style: 'test-v1' }] };
interface Stored { bytes: Buffer; metadata: ObjectMetadata; etag: string }
class MemoryStore implements ObjectStore {
	objects = new Map<string, Stored>();
	writes: string[] = [];
	beforePut?: (key: string) => Promise<void>;
	async get(key: string) {
		const item = this.objects.get(key);
		return item ? new Response(new Uint8Array(item.bytes), { headers: { etag: item.etag, 'content-length': String(item.bytes.length) } }) : null;
	}
	async put(key: string, blob: Blob, condition: WriteCondition, metadata: ObjectMetadata) {
		await this.beforePut?.(key);
		const old = this.objects.get(key);
		if ('ifNoneMatch' in condition ? !!old : old?.etag !== condition.ifMatch) throw new PreconditionFailed();
		const bytes = Buffer.from(await blob.arrayBuffer());
		this.writes.push(key);
		this.objects.set(key, { bytes, metadata, etag: `"${this.writes.length}-${sha256(bytes)}"` });
	}
}

type Fault = (request: IncomingMessage, item: Stored) => { status?: number; headers?: Record<string, string>; body?: Buffer } | undefined;
async function endpoint(store: MemoryStore, fault?: Fault) {
	const requests: string[] = [];
	const server = createServer((req, res) => {
		const key = decodeURIComponent(new URL(req.url!, 'https://maps.example').pathname.slice(1));
		requests.push(`${req.method} ${key}`);
		const item = store.objects.get(key);
		if (!item) { res.writeHead(404).end(); return; }
		const headers: Record<string, string> = {
			'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, Content-Range',
			'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': 'Range, If-Range',
			'content-type': item.metadata.contentType, 'cache-control': item.metadata.cacheControl,
			'content-length': String(item.bytes.length), etag: item.etag
		};
		let status = 200; let body = item.bytes;
		if (req.method === 'OPTIONS') { status = 204; delete headers['content-length']; body = Buffer.alloc(0); }
		if (req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === item.etag)) {
			const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)!;
			const start = match[1] ? Number(match[1]) : Math.max(0, body.length - Number(match[2]));
			const end = match[1] && match[2] ? Number(match[2]) : body.length - 1;
			if (start >= body.length) { status = 416; headers['content-range'] = `bytes */${body.length}`; body = Buffer.alloc(0); }
			else { status = 206; headers['content-range'] = `bytes ${start}-${end}/${body.length}`; body = body.subarray(start, end + 1); }
			headers['content-length'] = String(body.length);
		}
		const alteration = fault?.(req, item);
		if (alteration?.status) status = alteration.status;
		Object.assign(headers, alteration?.headers);
		if (alteration?.body) body = alteration.body;
		res.writeHead(status, headers).end(req.method === 'HEAD' ? undefined : body);
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address(); assert(address && typeof address !== 'string');
	const fetcher: Fetcher = (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		return fetch(`http://127.0.0.1:${address.port}${url.pathname}`, init);
	};
	return { fetcher, requests, close: async () => {
		server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	} };
}

/** Synthetic bytes exercise publication semantics; content validation has its own fixtures. */
async function bundle(version = '20261106-v1', dataDate = '2026-11-06') {
	const directory = await mkdtemp(path.join(tmpdir(), 'pmtiles-publish-test-'));
	const assets: PackageAsset[] = [];
	const bytes = new Map<string, Buffer>();
	function add(filePath: string, data: Buffer, fields: Record<string, unknown>) {
		bytes.set(filePath, data);
		assets.push({ path: filePath, bytes: data.length, sha256: sha256(data), ...fields } as PackageAsset);
	}
	for (const theme of ['light', 'dark']) {
		add(`${theme}.json`, Buffer.from(`style-${theme}`), { kind: 'style', theme });
		for (const density of [1, 2]) {
			const suffix = density === 1 ? '' : '@2x';
			add(`sprites/${theme}${suffix}.json`, Buffer.from(`index-${theme}-${density}`), { kind: 'sprite-index', theme, density });
			add(`sprites/${theme}${suffix}.png`, Buffer.from(`image-${theme}-${density}`), { kind: 'sprite-image', theme, density });
		}
	}
	add('fonts/Noto%20Sans/0-255.pbf', Buffer.from('glyph'), { kind: 'glyph' });
	add('LICENSE.txt', Buffer.from('license'), { kind: 'license' });
	const archiveBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
	const archive = { path: 'basemap.pmtiles', bytes: archiveBytes.length, sha256: sha256(archiveBytes) };
	bytes.set(archive.path, archiveBytes);
	const manifest: OfflineMapManifest = {
		schemaVersion: 1, regionId: 'bucuresti-ilfov', version, dataDate,
		bounds: [25.8, 44.19, 26.49, 44.8], nativeZoom: { min: 0, max: 15 },
		compatibility: { renderer: 'maplibre', tileSchema: 'test-v1', style: 'test-v1', minReaderVersion: 1, maxReaderVersion: 1 },
		baseUrl: `${origin}/packages/bucuresti-ilfov/${version}/`, archive, assets,
		totalBytes: archive.bytes + assets.reduce((sum, file) => sum + file.bytes, 0),
		attributions: [{ text: 'Example', url: 'https://example.org/', licensePath: 'LICENSE.txt' }]
	};
	const rawManifest = Buffer.from(JSON.stringify(manifest));
	for (const [relative, content] of bytes) {
		const filename = path.join(directory, decodeURIComponent(relative)); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, content);
	}
	await writeFile(path.join(directory, 'manifest.json'), rawManifest);
	const digest = sha256(rawManifest);
	const receipt: BrowserReceipt = { schemaVersion: 1, manifestSha256: digest, toolRevision: revision,
		passed: true, scenarios: 84, themes: ['light', 'dark'], pixelRatios: [1, 2], offline: true };
	return { directory, manifest, rawManifest, receipt, validated: { manifestSha256: digest },
		cleanup: () => rm(directory, { recursive: true, force: true }) };
}

async function fixture(fault?: Fault) {
	const b = await bundle(); const store = new MemoryStore(); const server = await endpoint(store, fault);
	const options = { ...b, reader, store, corsOrigins: ['https://app.example'], fetch: server.fetcher, toolRevision: revision };
	return { ...b, store, server, options, cleanup: async () => { await server.close(); await b.cleanup(); } };
}

const latestKey = 'packages/bucuresti-ilfov/latest.json';

test('publishes immutable bytes and public range/CORS-verified objects before latest; identical retry is safe', async () => {
	const f = await fixture();
	try {
		const result = await publishPackage(f.options);
		assert.equal(result.uploaded, f.manifest.assets.length + 2);
		assert.equal(f.store.writes.at(-1), latestKey);
		assert(f.server.requests.some(x => x.startsWith('HEAD ')));
		assert(f.server.requests.some(x => x.startsWith('OPTIONS ')));
		assert(f.store.objects.has('packages/bucuresti-ilfov/20261106-v1/fonts/Noto Sans/0-255.pbf'));
		const again = await publishPackage(f.options);
		assert.equal(again.uploaded, 0); assert.equal(again.reused, result.uploaded);
	} finally { await f.cleanup(); }
});

test('rejects changed local bytes and mismatched/missing browser validation before latest can appear', async () => {
	const f = await fixture();
	try {
		await assert.rejects(publishPackage({ ...f.options, receipt: { ...f.receipt, manifestSha256: 'b'.repeat(64) } }), /receipt required/);
		assert.equal(f.store.writes.length, 0);
		await assert.rejects(publishPackage({ ...f.options, receipt: { ...f.receipt, scenarios: 42 } }), /receipt required/);
		await writeFile(path.join(f.directory, 'LICENSE.txt'), 'changed');
		await assert.rejects(publishPackage(f.options), /changed/);
		assert.equal(f.store.objects.has(latestKey), false);
	} finally { await f.cleanup(); }
});

test('failed upload leaves existing latest and immutable old version intact', async () => {
	const f = await fixture(); const next = await bundle('20261107-v1', '2026-11-07');
	try {
		await publishPackage(f.options);
		const old = f.store.objects.get(latestKey)!;
		f.store.beforePut = async key => { if (key.includes('20261107-v1') && key.endsWith('LICENSE.txt')) throw new Error('upload failed'); };
		await assert.rejects(publishPackage({ ...f.options, ...next }), /upload failed/);
		assert.equal(f.store.objects.get(latestKey), old);
		assert(f.store.objects.has('packages/bucuresti-ilfov/20261106-v1/manifest.json'));
	} finally { await next.cleanup(); await f.cleanup(); }
});

test('same version with different bytes fails without touching committed objects', async () => {
	const f = await fixture();
	try {
		await publishPackage(f.options); const count = f.store.writes.length;
		const nextManifest = { ...f.manifest, attributions: [{ ...f.manifest.attributions[0], text: 'Changed' }] };
		const bytes = Buffer.from(JSON.stringify(nextManifest)); const digest = sha256(bytes);
		await writeFile(path.join(f.directory, 'manifest.json'), bytes);
		await assert.rejects(publishPackage({ ...f.options, validated: { manifestSha256: digest }, receipt: { ...f.receipt, manifestSha256: digest } }), /Immutable version conflict/);
		assert.equal(f.store.writes.length, count);
	} finally { await f.cleanup(); }
});

test('a concurrent publisher wins latest; stale CAS never falls back to unconditional PUT', async () => {
	const f = await fixture();
	try {
		const winner = Buffer.from('concurrent winner');
		f.store.beforePut = async key => {
			if (key === latestKey && !f.store.objects.has(key)) f.store.objects.set(key, { bytes: winner,
				metadata: { contentType: 'application/json', cacheControl: 'no-cache', sha256: sha256(winner) }, etag: '"winner"' });
		};
		await assert.rejects(publishPackage(f.options), PreconditionFailed);
		assert.deepEqual(f.store.objects.get(latestKey)!.bytes, winner);
		assert.equal(f.store.writes.includes(latestKey), false);
	} finally { await f.cleanup(); }
});

test('will not promote older data over a newer latest', async () => {
	const f = await fixture(); const older = await bundle('20261105-v1', '2026-11-05');
	try {
		await publishPackage(f.options); const count = f.store.writes.length;
		await assert.rejects(publishPackage({ ...f.options, ...older }), /newer map data/);
		assert.equal(f.store.writes.length, count);
	} finally { await older.cleanup(); await f.cleanup(); }
});

test('existing latest ETag is captured before uploads; another promotion wins safely', async () => {
	const f = await fixture(); const next = await bundle('20261107-v1', '2026-11-07');
	try {
		await publishPackage(f.options);
		const prior = f.store.objects.get(latestKey)!;
		const winner = { ...prior, etag: '"promoted-during-upload"' };
		f.store.beforePut = async key => { if (key.endsWith('20261107-v1/basemap.pmtiles')) f.store.objects.set(latestKey, winner); };
		await assert.rejects(publishPackage({ ...f.options, ...next }), PreconditionFailed);
		assert.equal(f.store.objects.get(latestKey), winner);
		assert.equal(f.store.writes.filter(key => key === latestKey).length, 1);
	} finally { await next.cleanup(); await f.cleanup(); }
});

for (const [name, mutate, error] of [
	['foreign manifest URL', (pointer: Record<string, unknown>) => { pointer.manifestUrl = 'https://unapproved.invalid/manifest.json'; }, /unexpected manifest location/],
	['manifest hash mismatch', (pointer: Record<string, unknown>) => { pointer.manifestSha256 = 'f'.repeat(64); }, /hash mismatch/],
	['path traversal version', (pointer: Record<string, unknown>) => { pointer.version = '../other'; }, /Invalid latest version/]
] as const) {
	test(`existing latest with ${name} fails before writes`, async () => {
		const f = await fixture(); const next = await bundle('20261107-v1', '2026-11-07');
		try {
			await publishPackage(f.options); const writes = f.store.writes.length;
			const old = f.store.objects.get(latestKey)!;
			const pointer = JSON.parse(old.bytes.toString('utf8'));
			mutate(pointer); old.bytes = Buffer.from(JSON.stringify(pointer));
			await assert.rejects(publishPackage({ ...f.options, ...next }), error);
			assert.equal(f.store.writes.length, writes);
		} finally { await next.cleanup(); await f.cleanup(); }
	});
}

test('bounded response readers cancel oversized and truncated bodies', async () => {
	let cancelled = 0;
	const oversized = () => new Response(new ReadableStream({
		start(controller) { controller.enqueue(new Uint8Array(32)); },
		cancel() { cancelled++; }
	}));
	await assert.rejects(readBounded(oversized(), 16), /read limit/);
	await assert.rejects(verifyBody(oversized(), { bytes: 16, sha256: '0'.repeat(64) }), /declared size/);
	assert.equal(cancelled, 2);
	await assert.rejects(verifyBody(new Response('short'), { bytes: 16, sha256: '0'.repeat(64) }), /size or SHA256/);
});

for (const [name, fault, error] of [
	['wrong public bytes', (req: IncomingMessage, item: Stored) => req.method === 'GET' && !req.headers.range ? { body: Buffer.alloc(item.bytes.length) } : undefined, /SHA256/],
	['CORS missing', () => ({ headers: { 'access-control-allow-origin': '' } }), /CORS/],
	['transformed representation', () => ({ headers: { 'content-encoding': 'br' } }), /transformed/],
	['wrong range bytes', (req: IncomingMessage) => req.headers.range === 'bytes=0-127' ? { body: Buffer.alloc(128) } : undefined, /Range bytes/],
	['wrong range metadata', (req: IncomingMessage) => req.headers.range ? { headers: { 'content-range': 'bytes 1-127/256' } } : undefined, /Range response/],
	['wrong range content type', (req: IncomingMessage) => req.headers.range ? { headers: { 'content-type': 'text/html' } } : undefined, /Content-Type/],
	['HEAD unavailable', (req: IncomingMessage) => req.method === 'HEAD' ? { status: 405 } : undefined, /HEAD failed/],
	['If-Range preflight blocked', (req: IncomingMessage) => req.method === 'OPTIONS' ? { headers: { 'access-control-allow-headers': 'Range' } } : undefined, /If-Range not allowed/],
	['wrong suffix bytes', (req: IncomingMessage) => req.headers.range === 'bytes=-64' ? { body: Buffer.alloc(64) } : undefined, /Suffix bytes/],
	['wrong 416 metadata', (req: IncomingMessage) => req.headers.range === 'bytes=256-' ? { headers: { 'content-range': 'bytes */257' } } : undefined, /Unsatisfiable/],
	['stale If-Range incorrectly respected', (req: IncomingMessage) => req.headers['if-range'] === '"pmtiles-deliberately-stale"' ? { status: 206 } : undefined, /Stale If-Range/],
	['public redirect', () => ({ status: 302, headers: { location: 'https://unapproved.invalid/' } }), /fetch failed/],
	['public missing object', (req: IncomingMessage) => req.url?.endsWith('LICENSE.txt') ? { status: 404 } : undefined, /GET failed/]
] as const) {
	test(`${name} prevents latest publication`, async () => {
		const f = await fixture(fault);
		try { await assert.rejects(publishPackage(f.options), error); assert.equal(f.store.objects.has(latestKey), false); }
		finally { await f.cleanup(); }
	});
}



test('failed public verification preserves previous latest after candidate upload', async () => {
	let broken = false;
	const f = await fixture(req => broken && req.method === 'HEAD' ? { status: 503 } : undefined);
	const next = await bundle('20261107-v1', '2026-11-07');
	try {
		await publishPackage(f.options); const old = f.store.objects.get(latestKey);
		broken = true;
		await assert.rejects(publishPackage({ ...f.options, ...next }), /HEAD failed/);
		assert.equal(f.store.objects.get(latestKey), old);
		assert(f.store.objects.has('packages/bucuresti-ilfov/20261107-v1/manifest.json'));
	} finally { await next.cleanup(); await f.cleanup(); }
});



test('same-date revision upgrade is allowed but retrying the older revision cannot roll latest back', async () => {
	const f = await fixture(); const newer = await bundle('20261106-v2');
	try {
		await publishPackage(f.options);
		await publishPackage({ ...f.options, ...newer });
		const latest = f.store.objects.get(latestKey); const writes = f.store.writes.length;
		await assert.rejects(publishPackage(f.options), /older package revision/);
		assert.equal(f.store.objects.get(latestKey), latest);
		assert.equal(f.store.writes.length, writes);
	} finally { await newer.cleanup(); await f.cleanup(); }
});

for (const version of ['release-a', '20261105-v1', '20261106-v0', '20261106-v01', '20261106-v9007199254740992']) {
	test(`unsupported pipeline version ${version} fails before writes`, async () => {
		const f = await fixture(); const candidate = await bundle(version);
		try {
			await assert.rejects(publishPackage({ ...f.options, ...candidate }), /pipeline version/);
			assert.equal(f.store.writes.length, 0);
		} finally { await candidate.cleanup(); await f.cleanup(); }
	});
}
