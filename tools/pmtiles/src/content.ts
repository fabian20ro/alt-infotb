import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync, inflateSync } from 'node:zlib';
import { PMTiles, Compression, TileType } from 'pmtiles';
import { validateStyleMin, createExpression, featureFilter, type StyleSpecification, type LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { ProtoReader, getMessages, getString, getVarint } from '../../../src/lib/api/proto.ts';
import { parseOfflineMapManifest, MAX_MANIFEST_BYTES, type ManifestReader, type OfflineMapManifest } from '../../../src/lib/offline-maps/manifest.ts';
import { FONT_STACKS } from './profile.ts';

const run = promisify(execFile);
const MAX_EXPANDED = 32 * 1024 * 1024;
const MAX_TILE_LOOKUPS = 100_000;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function requireThat(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
type Json = Record<string, any>;
function object(value: unknown, label: string): Json {
	requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
	return value as Json;
}
function json(bytes: Uint8Array, label: string): Json {
	try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), label); }
	catch (error) { throw new Error(`${label}: invalid JSON`, { cause: error }); }
}

/** Validate the pinned protobuf message schemas without losing wire-type information. */
function fields(bytes: Uint8Array, schema: Record<number, number>) {
	const reader = new ProtoReader(bytes);
	const result = new Map<number, Array<number | Uint8Array>>();
	while (!reader.done) {
		const field = reader.readField()!;
		requireThat(schema[field.fieldNumber] === field.wireType, `Invalid protobuf field ${field.fieldNumber} wire type`);
		const values = result.get(field.fieldNumber) ?? []; values.push(field.value); result.set(field.fieldNumber, values);
	}
	return result;
}

/** PNG integrity, including the compressed pixel stream, rather than trusting IHDR alone. */
export function validatePng(bytes: Uint8Array): { width: number; height: number } {
	const data = Buffer.from(bytes);
	requireThat(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid PNG signature');
	let offset = 8, width = 0, height = 0, ended = false;
	const compressed: Buffer[] = [];
	let chunks = 0;
	while (offset < data.length) {
		requireThat(offset + 12 <= data.length, 'Truncated PNG chunk');
		const length = data.readUInt32BE(offset);
		requireThat(length <= MAX_EXPANDED && offset + length + 12 <= data.length, 'Invalid PNG chunk length');
		const type = data.toString('ascii', offset + 4, offset + 8);
		const payload = data.subarray(offset + 8, offset + 8 + length);
		let crc = 0xffffffff;
		for (const byte of data.subarray(offset + 4, offset + 8 + length)) {
			crc ^= byte;
			for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
		}
		requireThat(((crc ^ 0xffffffff) >>> 0) === data.readUInt32BE(offset + 8 + length), `Invalid PNG ${type} CRC`);
		if (chunks++ === 0) requireThat(type === 'IHDR', 'PNG must start with IHDR');
		if (type === 'IHDR') {
			requireThat(chunks === 1 && length === 13, 'Invalid PNG IHDR');
			width = payload.readUInt32BE(0); height = payload.readUInt32BE(4);
			requireThat(width > 0 && height > 0 && width <= 8192 && height <= 8192, 'Invalid PNG dimensions');
			requireThat(payload[8] === 8 && payload[9] === 6 && payload[10] === 0 && payload[11] === 0 && payload[12] === 0,
				'Profile requires non-interlaced RGBA8 PNG');
		} else if (type === 'IDAT') compressed.push(payload);
		else if (type === 'IEND') { requireThat(length === 0 && compressed.length > 0, 'Invalid PNG IEND'); ended = true; }
		else requireThat(type[0] === type[0].toLowerCase(), `Unsupported critical PNG chunk ${type}`);
		offset += length + 12;
		if (ended) break;
	}
	requireThat(ended && offset === data.length, 'PNG missing IEND or trailing bytes');
	const expected = height * (width * 4 + 1);
	requireThat(expected <= MAX_EXPANDED, 'PNG exceeds decoded size limit');
	const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
	requireThat(pixels.length === expected, 'PNG pixel stream length mismatch');
	for (let row = 0; row < height; row++) requireThat(pixels[row * (width * 4 + 1)] <= 4, 'Invalid PNG row filter');
	return { width, height };
}

/** The upstream Devanagari directory intentionally aliases Sans Regular glyph payloads. */
const STACK_NAMES: Record<string, string> = {
	'Noto Sans Regular': 'Sans Regular', 'Noto Sans Medium': 'Sans Medium',
	'Noto Sans Italic': 'Sans Italic', 'Noto Sans Devanagari Regular v1': 'Sans Regular'
};
export function validateGlyph(bytes: Uint8Array, stack: string, rangeStart: number): number {
	const stacks = getMessages(fields(bytes, { 1: 2 }), 1);
	requireThat(stacks.length === 1, 'Glyph PBF must contain exactly one font stack');
	const stackFields = fields(stacks[0], { 1: 2, 2: 2, 3: 2 });
	requireThat(STACK_NAMES[stack] && (getString(stackFields, 1) === STACK_NAMES[stack] || (stack === 'Noto Sans Devanagari Regular v1' && getString(stackFields, 1) === 'NotoSansDevanagari-Regular-v1')), `Glyph stack mismatch: ${stack}`);
	requireThat(getString(stackFields, 2) === `${rangeStart}-${rangeStart + 255}`, 'Glyph range mismatch');
	const ids = new Set<number>();
	for (const message of getMessages(stackFields, 3)) {
		const glyph = fields(message, { 1: 0, 2: 2, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 });
		const id = getVarint(glyph, 1), width = getVarint(glyph, 3), height = getVarint(glyph, 4);
		requireThat(id !== undefined && id >= rangeStart && id < rangeStart + 256 && !ids.has(id), 'Invalid or duplicate glyph ID');
		requireThat(width !== undefined && height !== undefined && width <= 256 && height <= 256, 'Invalid glyph dimensions');
		for (const field of [5, 6, 7]) requireThat(getVarint(glyph, field) !== undefined, 'Missing glyph metrics');
		const bitmap = getMessages(glyph, 2);
		const expected = width === 0 || height === 0 ? 0 : (width + 6) * (height + 6);
		requireThat(bitmap.length <= 1 && (bitmap[0]?.length ?? 0) === expected, 'Glyph bitmap length mismatch');
		ids.add(id);
	}
	return ids.size;
}

function fontOutputs(value: unknown): string[] {
	if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string') && value.every(v => FONT_STACKS.includes(v as typeof FONT_STACKS[number]))) return value;
	requireThat(Array.isArray(value), 'Unsupported text-font value');
	if (value[0] === 'literal') return fontOutputs(value[1]);
	if (value[0] === 'case') return value.slice(2).filter((_, i) => i % 2 === 0 || i === value.length - 3).flatMap(fontOutputs);
	throw new Error('Unsupported dynamic text-font expression');
}
function inspectFontReferences(value: unknown, used: Set<string>) {
	if (!value || typeof value !== 'object') return;
	requireThat(!Array.isArray(value) || value[0] !== 'id', 'Feature ID expressions are unsupported by this profile');
	for (const [key, child] of Object.entries(value)) {
		if (key === 'text-font') fontOutputs(child).forEach(font => used.add(font));
		else inspectFontReferences(child, used);
	}
}

type Sprite = { x: number; y: number; width: number; height: number; pixelRatio: number };
export type ReadAsset = (path: string) => Promise<Uint8Array>;
export interface StyleAssets { styles: StyleSpecification[]; icons: Set<string>; glyphFiles: number; }
/** Public content seam: all references must resolve inside the declared, hash-checked package. */
export async function validateStyleAssets(manifest: OfflineMapManifest, readAsset: ReadAsset): Promise<StyleAssets> {
	const files = new Map(manifest.assets.map(asset => [asset.path, asset]));
	const styles: StyleSpecification[] = [];
	let icons: Set<string> | undefined;
	for (const theme of ['light', 'dark'] as const) {
		const stylePath = `${theme}.json`;
		requireThat(files.get(stylePath)?.kind === 'style', `Missing ${stylePath}`);
		const style = json(await readAsset(stylePath), stylePath);
		const errors = validateStyleMin(style as StyleSpecification);
		requireThat(errors.length === 0, `${stylePath}: ${errors.map(e => e.message).join('; ')}`);
		requireThat(style.glyphs === 'fonts/{fontstack}/{range}.pbf' && style.sprite === `sprites/${theme}`, `${stylePath}: external or incorrect resource URL`);
		requireThat(Object.keys(style.sources).join(',') === 'basemap', `${stylePath}: only the packaged basemap source is allowed`);
		const source = object(style.sources.basemap, 'basemap');
		requireThat(source.type === 'vector' && source.url === 'pmtiles://basemap.pmtiles' && !('tiles' in source), `${stylePath}: incorrect basemap URL`);
		requireThat(Object.keys(source).every(key => ['type', 'url', 'attribution'].includes(key)), `${stylePath}: unsupported source override`);
		const fonts = new Set<string>(); inspectFontReferences(style.layers, fonts);
		for (const layer of style.layers) if (layer.layout?.['text-field'] !== undefined) {
			requireThat(layer.layout['text-font'] !== undefined, `${stylePath}: text layer must declare packaged fonts`);
		}
		requireThat(fonts.size > 0, `${stylePath}: missing font references`);
		let first: Record<string, Sprite> | undefined;
		for (const density of [1, 2] as const) {
			const prefix = `sprites/${theme}${density === 2 ? '@2x' : ''}`;
			requireThat(files.get(`${prefix}.json`)?.kind === 'sprite-index' && files.get(`${prefix}.png`)?.kind === 'sprite-image', `Missing sprite pair ${prefix}`);
			const index = json(await readAsset(`${prefix}.json`), `${prefix}.json`) as Record<string, Sprite>;
			const png = validatePng(await readAsset(`${prefix}.png`));
			requireThat(Object.keys(index).length > 0, 'Empty sprite index');
			for (const [name, raw] of Object.entries(index)) {
				const icon = object(raw, `Sprite ${name}`);
				requireThat(['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(icon[k])) && icon.x >= 0 && icon.y >= 0 && icon.width > 0 && icon.height > 0 && icon.pixelRatio === density, `Invalid sprite rectangle ${name}`);
				requireThat(icon.x + icon.width <= png.width && icon.y + icon.height <= png.height, `Sprite outside atlas: ${name}`);
				if (first) requireThat(first[name] && first[name].width * 2 === icon.width && first[name].height * 2 === icon.height, `Sprite density mismatch: ${name}`);
			}
			if (first) requireThat(Object.keys(first).length === Object.keys(index).length, 'Sprite density key mismatch');
			first = index;
		}
		const names = new Set(Object.keys(first!));
		if (icons) requireThat(icons.size === names.size && [...icons].every(name => names.has(name)), 'Theme sprite keys differ');
		icons = names;
		styles.push(style as StyleSpecification);
	}
	let glyphFiles = 0;
	for (const stack of FONT_STACKS) for (let start = 0; start < 65536; start += 256) {
		const path = `fonts/${encodeURIComponent(stack)}/${start}-${start + 255}.pbf`;
		requireThat(files.get(path)?.kind === 'glyph', `Missing BMP glyph range ${path}`);
		validateGlyph(await readAsset(path), stack, start); glyphFiles++;
	}
	requireThat(manifest.assets.filter(asset => asset.kind === 'glyph').length === glyphFiles, 'Unexpected glyph file');
	resourceChecks(styles, icons!);
	return { styles, icons: icons!, glyphFiles };
}

interface TileFeature { type: 1 | 2 | 3; properties: Record<string, string | number | boolean>; }
function packed(bytes: Uint8Array): number[] {
	// ProtoReader handles message framing; packed uint32 values have no field tags.
	const result: number[] = [];
	let value = 0, shift = 0;
	for (const byte of bytes) {
		value += (byte & 127) * 2 ** shift;
		requireThat(value <= 0xffffffff && shift <= 28, 'Oversized packed uint32');
		if (byte & 128) shift += 7;
		else { result.push(value); value = 0; shift = 0; }
	}
	requireThat(shift === 0, 'Truncated packed varint');
	return result;
}
function tileValue(bytes: Uint8Array): string | number | boolean {
	const reader = new ProtoReader(bytes); const field = reader.readField();
	requireThat(field && reader.done, 'MVT value must have one typed value');
	if (field.fieldNumber === 1 && field.value instanceof Uint8Array) return new TextDecoder('utf-8', { fatal: true }).decode(field.value);
	if (field.wireType === 5 && field.fieldNumber === 2) return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(field.value as number, true);
	if (field.wireType === 1 && field.fieldNumber === 3) return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(field.value as number, true);
	requireThat(typeof field.value === 'number' && field.wireType === 0 && field.fieldNumber >= 4 && field.fieldNumber <= 7, 'Unsupported MVT value');
	if (field.fieldNumber === 7) { requireThat(field.value === 0 || field.value === 1, 'Invalid MVT boolean'); return !!field.value; }
	return field.fieldNumber === 6 ? (field.value % 2 ? -(field.value + 1) / 2 : field.value / 2) : field.value;
}
/** MVT IDs are uint64; the STB reader intentionally only supports safe-number varints.
 * Strip this optional identifier before decoding feature tags/geometry with ProtoReader.
 * IDs are not used by this pinned style profile (properties drive all expressions).
 */
function withoutFeatureId(bytes: Uint8Array): Uint8Array {
	let offset = 0;
	const parts: Uint8Array[] = [];
	function varint(): bigint {
		let result = 0n;
		for (let i = 0; i < 10; i++) {
			requireThat(offset < bytes.length, 'Truncated MVT varint');
			const byte = bytes[offset++];
			requireThat(i < 9 || byte <= 1, 'MVT varint exceeds uint64');
			result |= BigInt(byte & 127) << BigInt(i * 7);
			if (!(byte & 128)) return result;
		}
		throw new Error('MVT varint exceeds uint64');
	}
	while (offset < bytes.length) {
		const start = offset, tag = varint();
		requireThat(tag <= 0xffffffffn && tag >= 8n, 'Invalid MVT feature tag');
		const field = Number(tag) >>> 3, wire = Number(tag) & 7;
		if (wire === 0) varint();
		else if (wire === 2) { const length = varint(); requireThat(length <= BigInt(bytes.length - offset), 'Truncated MVT feature payload'); offset += Number(length); }
		else if (wire === 1 || wire === 5) offset += wire === 1 ? 8 : 4;
		else throw new Error('Unsupported MVT feature wire type');
		requireThat(offset <= bytes.length, 'Truncated MVT feature payload');
		if (field === 1) requireThat(wire === 0, 'Invalid MVT feature ID');
		else parts.push(bytes.subarray(start, offset));
	}
	return Buffer.concat(parts);
}
/** Decode every layer/feature and validate tag indices and geometry command framing. */
export function validateVectorTile(bytes: Uint8Array): Map<string, TileFeature[]> {
	const result = new Map<string, TileFeature[]>();
	for (const layerBytes of getMessages(fields(bytes, { 3: 2 }), 3)) {
		const layer = fields(layerBytes, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 0, 15: 0 });
		const name = getString(layer, 1);
		requireThat(name && !result.has(name) && getVarint(layer, 15) === 2 && (getVarint(layer, 5) ?? 4096) > 0, 'Invalid MVT layer');
		const keys = getMessages(layer, 3).map(value => new TextDecoder('utf-8', { fatal: true }).decode(value));
		const values = getMessages(layer, 4).map(tileValue);
		const features: TileFeature[] = [];
		for (const featureBytes of getMessages(layer, 2)) {
			const feature = fields(withoutFeatureId(featureBytes), { 2: 2, 3: 0, 4: 2 });
			const type = getVarint(feature, 3);
			requireThat(type === 1 || type === 2 || type === 3, 'Invalid MVT geometry type');
			const tags = getMessages(feature, 2).flatMap(packed);
			requireThat(tags.length % 2 === 0, 'Odd MVT tags');
			const properties: TileFeature['properties'] = Object.create(null);
			for (let i = 0; i < tags.length; i += 2) {
				requireThat(tags[i] < keys.length && tags[i + 1] < values.length, 'MVT tag index out of bounds');
				properties[keys[tags[i]]] = values[tags[i + 1]];
			}
			const geometry = getMessages(feature, 4).flatMap(packed);
			requireThat(geometry.length > 0, 'Empty MVT geometry');
			let pathOpen = false, lineDrawn = false;
			for (let i = 0; i < geometry.length;) {
				const command = geometry[i++], id = command & 7, count = Math.floor(command / 8);
				requireThat(count > 0 && [1, 2, 7].includes(id) && (id !== 7 || (type === 3 && count === 1)), 'Invalid MVT geometry command');
				if (type === 1) requireThat(id === 1 && i === 1, 'Invalid MVT point commands');
				else if (id === 1) {
					requireThat(count === 1 && (!pathOpen || (type === 2 && lineDrawn)), 'Invalid MVT path start');
					pathOpen = true; lineDrawn = false;
				} else if (id === 2) {
					requireThat(pathOpen && count >= (type === 3 ? 2 : 1), 'Invalid MVT line command'); lineDrawn = true;
				} else { requireThat(pathOpen && lineDrawn, 'Invalid MVT ring closure'); pathOpen = false; }
				if (id !== 7) i += count * 2;
				requireThat(i <= geometry.length, 'Truncated MVT geometry command');
			}
			requireThat(type === 1 || (type === 2 ? lineDrawn : !pathOpen), 'Incomplete MVT geometry');
			features.push({ type, properties });
		}
		result.set(name, features);
	}
	requireThat(result.size > 0, 'MVT contains no layers');
	return result;
}

function resourceChecks(styles: StyleSpecification[], icons: Set<string>) {
	return styles.flatMap(style => style.layers.flatMap((layer: LayerSpecification) => {
		const raw = layer as unknown as Json;
		return ['icon-image', 'fill-pattern', 'line-pattern', 'background-pattern'].flatMap(property => {
			const value = raw.layout?.[property] ?? raw.paint?.[property];
			if (value === undefined) return [];
			if (typeof value === 'string') requireThat(value === '' || icons.has(value), `Missing sprite ${value} in ${layer.id}`);
			const expression = createExpression(value, `${layer.id}.${property}`);
			requireThat(expression.result === 'success', `Invalid image expression in ${layer.id}`);
			return [{ layer: raw, filter: featureFilter(raw.filter, `${layer.id}.filter`), evaluate: expression.value,
				check(result: unknown) { requireThat(typeof result === 'string' && (result === '' || icons.has(result)), `Missing sprite ${String(result)} in ${layer.id}`); } }];
		});
	}));
}

async function validateArchive(path: string, manifest: OfflineMapManifest, assets: StyleAssets) {
	const handle = await open(path, 'r');
	try {
		const size = (await handle.stat()).size;
		const archive = new PMTiles({ getKey: () => path, getBytes: async (offset, length) => {
			requireThat(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length > 0 && length <= MAX_EXPANDED && offset + length <= size, 'Invalid PMTiles byte range');
			const buffer = Buffer.alloc(length); const read = await handle.read(buffer, 0, length, offset);
			requireThat(read.bytesRead === length, 'Truncated PMTiles range');
			return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
		} }, undefined, async (buffer, compression) => {
			requireThat(buffer.byteLength <= MAX_EXPANDED, 'Compressed PMTiles content exceeds limit');
			if (compression === Compression.None) return buffer;
			requireThat(compression === Compression.Gzip, 'Profile only supports gzip or uncompressed PMTiles');
			const result = gunzipSync(new Uint8Array(buffer), { maxOutputLength: MAX_EXPANDED });
			return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
		});
		const header = await archive.getHeader(); const metadata = object(await archive.getMetadata(), 'PMTiles metadata');
		requireThat(header.specVersion === 3 && header.tileType === TileType.Mvt, 'Expected PMTiles v3 MVT archive');
		requireThat(header.minZoom === manifest.nativeZoom.min && header.maxZoom === manifest.nativeZoom.max, 'Archive zoom mismatch');
		requireThat([header.minLon, header.minLat, header.maxLon, header.maxLat].every((n, i) => Math.abs(n - manifest.bounds[i]) < 0.000001), 'Archive bounds mismatch');
		requireThat(metadata.version === manifest.compatibility.tileSchema.replace(/^protomaps-/, ''), 'Archive schema version mismatch');
		requireThat(Array.isArray(metadata.vector_layers), 'PMTiles metadata missing vector_layers');
		const declaredLayers = new Set<string>();
		for (const layer of metadata.vector_layers) {
			const descriptor = object(layer, 'Vector layer metadata');
			requireThat(typeof descriptor.id === 'string' && descriptor.id && !declaredLayers.has(descriptor.id), 'Invalid metadata layer ID');
			object(descriptor.fields, 'Vector layer fields'); declaredLayers.add(descriptor.id);
		}
		for (const style of assets.styles) for (const layer of style.layers) {
			if ('source-layer' in layer) requireThat(declaredLayers.has(layer['source-layer']!), `Style references absent source layer ${layer['source-layer']}`);
		}
		const checks = resourceChecks(assets.styles, assets.icons);
		const deadline = Date.now() + 120_000;
		let decodedBytes = 0;
		let validatedTiles = 0, tileLookups = 0, validatedFeatures = 0;
		const coordinates = (lon: number, lat: number, z: number) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z)];
		for (let z = header.minZoom; z <= header.maxZoom; z++) {
			const [minX, minY] = coordinates(manifest.bounds[0], manifest.bounds[3], z);
			const [maxX, maxY] = coordinates(manifest.bounds[2], manifest.bounds[1], z);
			requireThat(tileLookups + (maxX - minX + 1) * (maxY - minY + 1) <= MAX_TILE_LOOKUPS, 'Archive exceeds tile validation work limit');
			for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
				requireThat(Date.now() <= deadline, 'Tile validation exceeded two minute work limit');
				tileLookups++;
				const tile = await archive.getZxy(z, x, y); if (!tile) continue;
				decodedBytes += tile.data.byteLength;
				requireThat(decodedBytes <= 2 * 1024 ** 3, 'Archive exceeds total decoded tile size limit');
				const layers = validateVectorTile(new Uint8Array(tile.data)); validatedTiles++;
				for (const layer of layers.keys()) requireThat(declaredLayers.has(layer), `Undeclared vector tile layer ${layer}`);
				for (const features of layers.values()) validatedFeatures += features.length;
				requireThat(validatedFeatures <= 10_000_000, 'Archive exceeds feature validation work limit');
				for (const check of checks) {
					// At the native maximum zoom, the same features also serve overzoomed views.
					for (let zoom = z; zoom <= (z === header.maxZoom ? 22 : z); zoom++) {
						if (zoom < (check.layer.minzoom ?? 0) || zoom >= (check.layer.maxzoom ?? 24)) continue;
						const features = check.layer['source-layer'] ? layers.get(check.layer['source-layer']) ?? [] : [{ type: 1 as const, properties: {} }];
						for (const feature of features) if (check.filter.filter({ zoom }, feature)) {
							check.check(check.evaluate.evaluateWithoutErrorHandling({ zoom }, feature));
						}
					}
				}
			}
		}
		requireThat(validatedTiles > 0 && validatedTiles === header.numAddressedTiles, 'Archive has unvalidated tiles outside manifest bounds or inconsistent tile count');
		return { validatedTiles, tileLookups, validatedFeatures, decodedBytes };
	} finally { await handle.close(); }
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		requireThat(!entry.isSymbolicLink(), `Symlink in package: ${path}`);
		if (entry.isDirectory()) result.push(...await listFiles(directory, path));
		else { requireThat(entry.isFile(), `Non-regular package file: ${path}`); result.push(path); }
	}
	return result;
}
export interface PackageValidationOptions { pmtilesCli?: string; expectedCliVersion?: string; }
export async function validatePackage(directory: string, reader: ManifestReader, options: PackageValidationOptions = {}) {
	requireThat((await lstat(directory)).isDirectory(), 'Package root must be a real directory');
	const actual = await listFiles(directory);
	const manifestPath = join(directory, 'manifest.json');
	requireThat((await lstat(manifestPath)).size <= MAX_MANIFEST_BYTES, 'Manifest exceeds size limit');
	const bytes = await readFile(manifestPath);
	const manifest = parseOfflineMapManifest(JSON.parse(bytes.toString('utf8')), reader);
	requireThat(manifest.archive.path === 'basemap.pmtiles', 'Profile requires basemap.pmtiles');
	const expected = new Set(['manifest.json', ...[manifest.archive, ...manifest.assets].map(file => decodeURIComponent(file.path))]);
	requireThat(expected.size === actual.length && actual.every(path => expected.has(path)), 'Package contains undeclared or missing files');
	for (const file of [manifest.archive, ...manifest.assets]) {
		const path = join(directory, decodeURIComponent(file.path));
		requireThat((await lstat(path)).size === file.bytes, `Size mismatch: ${file.path}`);
		const digest = createHash('sha256'); for await (const chunk of createReadStream(path)) digest.update(chunk);
		requireThat(digest.digest('hex') === file.sha256, `SHA256 mismatch: ${file.path}`);
	}
	const assets = await validateStyleAssets(manifest, path => readFile(join(directory, decodeURIComponent(path))));
	const cli = options.pmtilesCli ?? 'pmtiles';
	const version = (await run(cli, ['version'], { timeout: 10_000, maxBuffer: 64 * 1024 })).stdout.trim();
	const expectedVersion = options.expectedCliVersion ?? '1.31.2';
	requireThat(version.startsWith(`pmtiles ${expectedVersion},`), `Unexpected pmtiles CLI version: ${version}`);
	await run(cli, ['verify', join(directory, manifest.archive.path)], { timeout: 120_000, maxBuffer: 1024 * 1024 });
	const archive = await validateArchive(join(directory, manifest.archive.path), manifest, assets);
	return { manifest, manifestSha256: hash(bytes), fileCount: expected.size, glyphFiles: assets.glyphFiles, ...archive };
}
