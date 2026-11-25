import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBrowserCandidateValidator } from '../src/browser-validation.ts';
import { PROFILE } from '../src/profile.ts';
import type { Generation, GenerationStore } from '../../../src/lib/offline-maps/contracts.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const controller = () => new AbortController();
function fixture(archive: Uint8Array, assetCount = 1) {
	const bytes = new TextEncoder().encode('persisted glyph bytes');
	const assets = Array.from({ length: assetCount }, (_, i) => ({
		kind: 'glyph' as const, path: `fonts/Test/${i * 256}-${i * 256 + 255}.pbf`, bytes: bytes.length, sha256: sha(bytes)
	}));
	const generation: Generation = { id: 'stored-generation', manifestSha256: 'a'.repeat(64), manifest: {
		schemaVersion: 1, regionId: 'bucharest-ilfov', version: '20261107-v1', dataDate: '2026-11-07',
		baseUrl: 'https://maps.example/bucharest-ilfov/20261107-v1/', bounds: [25, 44, 27, 45], nativeZoom: { min: 0, max: 15 },
		compatibility: { ...PROFILE, minReaderVersion: 1, maxReaderVersion: 1 },
		archive: { path: 'map.pmtiles', bytes: archive.length, sha256: sha(archive) }, assets,
		totalBytes: archive.length + assets.length * bytes.length, attributions: []
	} };
	const readPaths: string[] = [];
	const store: GenerationStore = {
		async create() {}, async write() {}, async remove() {}, async inspect() { return true; },
		async archive() { return new Blob([archive as Uint8Array<ArrayBuffer>]); },
		async asset(_generation, path) { readPaths.push(path); return new Blob([bytes]); }
	};
	return { generation, store, bytes, readPaths };
}

test('candidate readback rejects same-size archive corruption beyond its first MiB using bounded reads', async () => {
	const original = new Uint8Array(2 * 1024 * 1024 + 17).fill(12);
	const f = fixture(original); const corrupt = original.slice(); corrupt[corrupt.length - 1] ^= 1;
	const sizes: number[] = [];
	class ReadbackBlob extends Blob {
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole archive allocation forbidden'); }
		override slice(start?: number, end?: number, contentType?: string): Blob {
			const part = super.slice(start, end, contentType); sizes.push(part.size); return part;
		}
	}
	f.store.archive = async () => new ReadbackBlob([corrupt]);
	await assert.rejects(createBrowserCandidateValidator(f.store)(f.generation, controller().signal), /stored SHA256 mismatch: map.pmtiles/);
	assert.deepEqual(sizes, [1024 * 1024, 1024 * 1024, 17]);
	assert.deepEqual(f.readPaths, []);
});

test('candidate readback hashes every stored asset before archive schema validation', async () => {
	const f = fixture(new Uint8Array(32), 4);
	f.store.asset = async (_generation, path) => {
		f.readPaths.push(path);
		return new Blob([path === f.generation.manifest.assets[3].path ? new Uint8Array(f.bytes.length) : f.bytes]);
	};
	await assert.rejects(createBrowserCandidateValidator(f.store)(f.generation, controller().signal), /stored SHA256 mismatch: fonts\/Test\/768-1023.pbf/);
	assert.deepEqual(f.readPaths, f.generation.manifest.assets.map(asset => asset.path));
});

test('candidate readback rejects a truncated slice despite a correct Blob size', async () => {
	const f = fixture(new Uint8Array(32));
	class TruncatedBlob extends Blob {
		override slice(): Blob { return new Blob([new Uint8Array(31)]); }
	}
	f.store.archive = async () => new TruncatedBlob([new Uint8Array(32)]);
	await assert.rejects(createBrowserCandidateValidator(f.store)(f.generation, controller().signal), /truncated stored read: map.pmtiles/);
});

test('candidate readback cancellation interrupts a stalled storage read', async () => {
	const f = fixture(new Uint8Array(32)); const abort = controller();
	let started!: () => void;
	const reading = new Promise<void>(resolve => { started = resolve; });
	class StalledBlob extends Blob {
		override slice(): Blob {
			const slice = super.slice();
			slice.arrayBuffer = () => { started(); return new Promise(() => {}); };
			return slice;
		}
	}
	f.store.archive = async () => new StalledBlob([new Uint8Array(32)]);
	const validation = createBrowserCandidateValidator(f.store)(f.generation, abort.signal);
	await reading;
	abort.abort(new DOMException('Cancelled during stored readback', 'AbortError'));
	await assert.rejects(validation, { name: 'AbortError' });
	assert.deepEqual(f.readPaths, []);
});
