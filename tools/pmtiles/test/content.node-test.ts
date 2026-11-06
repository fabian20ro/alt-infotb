import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { validateGlyph, validatePng, validateStyleAssets, validateVectorTile, validatePackage } from '../src/content.ts';
import { FONT_STACKS, PROFILE, readerFor } from '../src/profile.ts';
import type { OfflineMapManifest, PackageAsset } from '../../../src/lib/offline-maps/manifest.ts';

// Tiny real PNG/protobuf payloads built from their file formats, with targeted corruption.
const concat = (...parts: Uint8Array[]) => Buffer.concat(parts);
function uint(value: number): Buffer {
	const out: number[] = [];
	do { const byte = value & 127; value = Math.floor(value / 128); out.push(byte | (value ? 128 : 0)); } while (value);
	return Buffer.from(out);
}
const string = (text: string) => Buffer.from(text);
const numberField = (field: number, value: number) => concat(uint(field * 8), uint(value));
const byteField = (field: number, value: Uint8Array) => concat(uint(field * 8 + 2), uint(value.length), value);
function glyph(stack: string, start = 0, glyphBytes = Buffer.alloc(0)): Buffer {
	const internal = stack === 'Noto Sans Devanagari Regular v1' ? 'Sans Regular' : stack.replace('Noto ', '');
	return byteField(1, concat(byteField(1, string(internal)), byteField(2, string(`${start}-${start + 255}`)), glyphBytes));
}
function png(width = 1, height = 1): Buffer {
	function chunk(type: string, payload: Buffer) {
		const size = Buffer.alloc(4); size.writeUInt32BE(payload.length);
		const content = concat(string(type), payload); let crc = 0xffffffff;
		for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
		const end = Buffer.alloc(4); end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
		return concat(size, content, end);
	}
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
	return concat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(height * (width * 4 + 1)))), chunk('IEND', Buffer.alloc(0)));
}
function fixture() {
	const data = new Map<string, Buffer>(); const assets: PackageAsset[] = [];
	const descriptor = (path: string, bytes: Buffer) => ({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
	const add = (path: string, bytes: Buffer, fields: Record<string, unknown>) => { data.set(path, bytes); assets.push({ ...descriptor(path, bytes), ...fields } as PackageAsset); };
	for (const theme of ['light', 'dark'] as const) {
		add(`${theme}.json`, string(JSON.stringify({ version: 8, sources: { basemap: { type: 'vector', url: 'pmtiles://basemap.pmtiles' } }, glyphs: 'fonts/{fontstack}/{range}.pbf', sprite: `sprites/${theme}`, layers: [{ id: 'labels', type: 'symbol', source: 'basemap', 'source-layer': 'places', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'icon-image': 'townspot' } }] })), { kind: 'style', theme });
		for (const density of [1, 2] as const) {
			const prefix = `sprites/${theme}${density === 2 ? '@2x' : ''}`;
			add(`${prefix}.json`, string(JSON.stringify({ townspot: { x: 0, y: 0, width: density, height: density, pixelRatio: density } })), { kind: 'sprite-index', theme, density });
			add(`${prefix}.png`, png(density, density), { kind: 'sprite-image', theme, density });
		}
	}
	for (const stack of FONT_STACKS) for (let start = 0; start < 65536; start += 256) add(`fonts/${encodeURIComponent(stack)}/${start}-${start + 255}.pbf`, glyph(stack, start), { kind: 'glyph' });
	add('licenses/map.txt', string('Test license'), { kind: 'license' });
	data.set('basemap.pmtiles', Buffer.from([1]));
	const archive = descriptor('basemap.pmtiles', data.get('basemap.pmtiles')!);
	const manifest: OfflineMapManifest = {
		schemaVersion: 1, regionId: 'bucuresti-ilfov', version: '2026-11-06-r1', dataDate: '2026-11-06', bounds: [25.8, 44.19, 26.49, 44.8], nativeZoom: { min: 0, max: 15 },
		compatibility: { ...PROFILE, minReaderVersion: 1, maxReaderVersion: 1 }, baseUrl: 'https://maps.example.test/bucuresti-ilfov/2026-11-06-r1/', archive, assets,
		totalBytes: archive.bytes + assets.reduce((sum, asset) => sum + asset.bytes, 0), attributions: [{ text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licensePath: 'licenses/map.txt' }]
	};
	return { manifest, data, read: async (path: string) => { const bytes = data.get(path); assert.ok(bytes, `Unexpected asset ${path}`); return bytes; } };
}
function editJson(data: Map<string, Buffer>, path: string, edit: (value: any) => void) {
	const value = JSON.parse(data.get(path)!.toString()); edit(value); data.set(path, string(JSON.stringify(value)));
}

test('complete local style closure includes both themes, densities and all 1,024 BMP ranges', async () => {
	const f = fixture(); const result = await validateStyleAssets(f.manifest, f.read);
	assert.equal(result.glyphFiles, 1024); assert.deepEqual([...result.icons], ['townspot']);
});
for (const [name, mutate, pattern] of [
	['remote glyph dependency', (f: ReturnType<typeof fixture>) => editJson(f.data, 'light.json', s => s.glyphs = 'https://example.com/{fontstack}/{range}.pbf'), /resource URL/],
	['remote vector source', (f: ReturnType<typeof fixture>) => editJson(f.data, 'light.json', s => s.sources.basemap.url = 'https://example.com/map'), /basemap URL/],
	['invalid style property', (f: ReturnType<typeof fixture>) => editJson(f.data, 'light.json', s => s.layers[0].layout['symbol-placement'] = 'garbage'), /symbol-placement/],
	['unknown font', (f: ReturnType<typeof fixture>) => editJson(f.data, 'light.json', s => s.layers[0].layout['text-font'] = ['Unbundled Font']), /text-font/],
	['missing static sprite', (f: ReturnType<typeof fixture>) => editJson(f.data, 'light.json', s => s.layers[0].layout['icon-image'] = 'absent'), /Missing sprite/],
	['missing BMP range', (f: ReturnType<typeof fixture>) => { f.manifest.assets = f.manifest.assets.filter(a => a.path !== 'fonts/Noto%20Sans%20Regular/256-511.pbf'); }, /Missing BMP glyph range/],
	['sprite overflow', (f: ReturnType<typeof fixture>) => editJson(f.data, 'sprites/light.json', s => s.townspot.x = 1), /outside atlas/],
	['sprite density mismatch', (f: ReturnType<typeof fixture>) => editJson(f.data, 'sprites/light@2x.json', s => s.townspot.width = 1), /density mismatch/],
	['sprite theme mismatch', (f: ReturnType<typeof fixture>) => { for (const suffix of ['', '@2x']) editJson(f.data, `sprites/dark${suffix}.json`, s => { s.other = s.townspot; delete s.townspot; }); }, /Theme sprite keys/]
] as const) test(`rejects ${name}`, async () => { const f = fixture(); mutate(f); await assert.rejects(validateStyleAssets(f.manifest, f.read), pattern); });

test('PNG validation rejects truncation, CRC damage, and bytes after IEND', () => {
	assert.deepEqual(validatePng(png()), { width: 1, height: 1 });
	const damaged = png(); damaged[20] ^= 1;
	assert.throws(() => validatePng(damaged), /CRC/);
	assert.throws(() => validatePng(png().subarray(0, -2)), /Truncated/);
	assert.throws(() => validatePng(concat(png(), Buffer.from([0]))), /trailing bytes/);
});
test('glyph validation checks stack/range and SDF dimensions, allowing an empty Unicode range', () => {
	assert.equal(validateGlyph(glyph('Noto Sans Regular'), 'Noto Sans Regular', 0), 0);
	assert.throws(() => validateGlyph(glyph('Noto Sans Regular'), 'Noto Sans Italic', 0), /stack mismatch/);
	assert.throws(() => validateGlyph(glyph('Noto Sans Regular'), 'Noto Sans Regular', 256), /range mismatch/);
	const metrics = concat(numberField(1, 65), numberField(3, 1), numberField(4, 1), numberField(5, 0), numberField(6, 0), numberField(7, 1));
	assert.throws(() => validateGlyph(glyph('Noto Sans Regular', 0, byteField(3, metrics)), 'Noto Sans Regular', 0), /bitmap length/);
	const complete = byteField(3, concat(metrics, byteField(2, Buffer.alloc(49))));
	assert.equal(validateGlyph(glyph('Noto Sans Regular', 0, complete), 'Noto Sans Regular', 0), 1);
	assert.throws(() => validateGlyph(glyph('Noto Sans Regular', 0, concat(complete, complete)), 'Noto Sans Regular', 0), /duplicate glyph/);
});
function tile(tags = [0, 0], geometry = [9, 2, 2], id = Buffer.alloc(0)) {
	const feature = concat(id, byteField(2, Buffer.from(tags)), numberField(3, 1), byteField(4, Buffer.from(geometry)));
	return byteField(3, concat(byteField(1, string('places')), byteField(2, feature), byteField(3, string('name')), byteField(4, byteField(1, string('București'))), numberField(5, 4096), numberField(15, 2)));
}
test('MVT content decoder verifies feature tags and geometry command framing', () => {
	assert.equal(validateVectorTile(tile()).get('places')?.[0].properties.name, 'București');
	assert.throws(() => validateVectorTile(tile([0])), /Odd MVT tags/);
	assert.throws(() => validateVectorTile(tile([0, 1])), /index out of bounds/);
	assert.throws(() => validateVectorTile(tile([0, 0], [9, 2])), /Truncated MVT geometry/);
	assert.throws(() => validateVectorTile(tile([0, 0], [15])), /Invalid MVT geometry command/);
	assert.equal(validateVectorTile(tile([0, 0], [9, 2, 2], Buffer.from([8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1]))).size, 1);
	assert.throws(() => validateVectorTile(tile([0, 0], [9, 2, 2], Buffer.from([8, 255, 255, 255, 255, 255, 255, 255, 255, 255, 2]))), /uint64/);
	assert.throws(() => validateVectorTile(tile().subarray(0, -1)), /truncated payload/);
});

for (const fault of ['extra-file', 'symlink', 'size', 'hash'] as const) test(`package rejects ${fault} before invoking the PMTiles CLI`, async () => {
	const f = fixture(); const directory = await mkdtemp(join(tmpdir(), 'pmtiles-validator-'));
	try {
		for (const [path, data] of f.data) { const disk = join(directory, decodeURIComponent(path)); await mkdir(dirname(disk), { recursive: true }); await writeFile(disk, data); }
		await writeFile(join(directory, 'manifest.json'), JSON.stringify(f.manifest));
		if (fault === 'extra-file') await writeFile(join(directory, 'unlisted.txt'), 'surprise');
		if (fault === 'symlink') await symlink('/etc/passwd', join(directory, 'unlisted-link'));
		if (fault === 'size') await writeFile(join(directory, 'basemap.pmtiles'), Buffer.from([1, 2]));
		if (fault === 'hash') await writeFile(join(directory, 'basemap.pmtiles'), Buffer.from([2]));
		await assert.rejects(validatePackage(directory, readerFor('https://maps.example.test'), { pmtilesCli: '/must-not-run' }), fault === 'extra-file' ? /undeclared/ : fault === 'symlink' ? /Symlink/ : fault === 'size' ? /Size mismatch/ : /SHA256 mismatch/);
	} finally { await rm(directory, { recursive: true, force: true }); }
});
