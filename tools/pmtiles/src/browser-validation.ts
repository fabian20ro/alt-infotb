import { FileSource, PMTiles, TileType } from 'pmtiles';
import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Generation, GenerationStore } from '../../../src/lib/offline-maps/contracts.ts';
import type { PackageFile } from '../../../src/lib/offline-maps/manifest.ts';
import { FONT_STACKS, PLACES, PROFILE } from './profile.ts';

function requireThat(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Offline candidate: ${message}`);
}
function object(value: unknown): Record<string, unknown> {
	requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected JSON object');
	return value as Record<string, unknown>;
}

async function cancellable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) { void operation.catch(() => {}); signal.throwIfAborted(); }
	let abort: () => void = () => {};
	const cancelled = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
	});
	try { return await Promise.race([operation, cancelled]); }
	finally { signal.removeEventListener('abort', abort); }
}

/** Re-read persisted bytes after writer close; never allocate the entire archive in memory. */
async function verifyStoredFile(blob: Blob, file: PackageFile, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	requireThat(blob.size === file.bytes, `stored size mismatch: ${file.path}`);
	const hash = sha256.create();
	try {
		for (let offset = 0; offset < file.bytes; offset += 1024 * 1024) {
			signal.throwIfAborted();
			const end = Math.min(offset + 1024 * 1024, file.bytes);
			const bytes = new Uint8Array(await cancellable(blob.slice(offset, end).arrayBuffer(), signal));
			requireThat(bytes.byteLength === end - offset, `truncated stored read: ${file.path}`);
			hash.update(bytes);
		}
		signal.throwIfAborted();
		const digest = Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
		requireThat(digest === file.sha256, `stored SHA256 mismatch: ${file.path}`);
	} finally { hash.destroy(); }
}

function fontOutputs(value: unknown): string[] {
	if (Array.isArray(value) && value.length === 1 && FONT_STACKS.includes(value[0] as typeof FONT_STACKS[number])) return value;
	requireThat(Array.isArray(value), 'unsupported font stack');
	if (value[0] === 'literal') return fontOutputs(value[1]);
	if (value[0] === 'case') return value.slice(2).filter((_, i) => i % 2 === 0 || i === value.length - 3).flatMap(fontOutputs);
	throw new Error('Offline candidate: unsupported combined or dynamic font stack');
}
function checkFontReferences(value: unknown) {
	if (!value || typeof value !== 'object') return;
	for (const [key, child] of Object.entries(value)) {
		if (key === 'text-font') fontOutputs(child);
		else checkFontReferences(child);
	}
}

/** Browser counterpart of the pipeline gate, not a replacement for its exhaustive tile/glyph audit.
 * Trust comes from the configured offer digest and per-file SHA256 verification on storage readback.
 * This checks the stored candidate's profile, local resource closure and representative tile reads.
 */
export function createBrowserCandidateValidator(files: GenerationStore) {
	return async (generation: Generation, signal: AbortSignal): Promise<void> => {
		const manifest = generation.manifest;
		requireThat(manifest.compatibility.renderer === PROFILE.renderer && manifest.compatibility.style === PROFILE.style &&
			manifest.compatibility.tileSchema === PROFILE.tileSchema, 'unsupported renderer profile');
		signal.throwIfAborted();
		requireThat(await cancellable(files.inspect(generation), signal), 'stored files missing or truncated');
		const blob = await cancellable(files.archive(generation), signal);
		await verifyStoredFile(blob, manifest.archive, signal);
		for (const asset of manifest.assets) {
			signal.throwIfAborted();
			await verifyStoredFile(await cancellable(files.asset(generation, asset.path), signal), asset, signal);
		}
		const archive = new PMTiles(new FileSource(new File([blob], manifest.archive.path)));
		const header = await archive.getHeader();
		requireThat(header.specVersion === 3 && header.tileType === TileType.Mvt, 'expected PMTiles v3 vector tiles');
		requireThat(header.minZoom === manifest.nativeZoom.min && header.maxZoom === manifest.nativeZoom.max, 'archive zoom mismatch');
		requireThat([header.minLon, header.minLat, header.maxLon, header.maxLat].every((n, i) => Math.abs(n - manifest.bounds[i]) < 0.000001), 'archive bounds mismatch');
		const metadata = object(await archive.getMetadata());
		requireThat(metadata.version === PROFILE.tileSchema.replace('protomaps-', ''), 'archive tile schema mismatch');
		requireThat(Array.isArray(metadata.vector_layers), 'missing vector layer metadata');
		const sourceLayers = new Set(metadata.vector_layers.map(layer => object(layer).id));
		const assets = new Map(manifest.assets.map(asset => [asset.path, asset]));
		async function json(path: string) {
			signal.throwIfAborted();
			return object(JSON.parse(await (await files.asset(generation, path)).text()));
		}
		let themeIcons: Set<string> | undefined;
		for (const theme of ['light', 'dark'] as const) {
			const stylePath = `${theme}.json`;
			const styleAsset = assets.get(stylePath);
			requireThat(styleAsset?.kind === 'style' && styleAsset.theme === theme, 'missing style descriptor');
			const style = await json(stylePath);
			requireThat(Object.keys(style).every(key => ['version', 'glyphs', 'sprite', 'sources', 'layers'].includes(key)), 'unsupported style field');
			requireThat(validateStyleMin(style as unknown as StyleSpecification).length === 0, 'invalid style');
			requireThat(style.glyphs === 'fonts/{fontstack}/{range}.pbf' && style.sprite === `sprites/${theme}`, 'non-local style resource');
			const sources = object(style.sources);
			requireThat(Object.keys(sources).join(',') === 'basemap', 'unexpected map source');
			const source = object(sources.basemap);
			requireThat(source.type === 'vector' && source.url === `pmtiles://${manifest.archive.path}` &&
				Object.keys(source).every(key => ['type', 'url', 'attribution'].includes(key)), 'non-local source override');
			for (const layer of (style as unknown as StyleSpecification).layers) {
				if ('source-layer' in layer) requireThat(sourceLayers.has(layer['source-layer']), 'style references absent vector layer');
				if (layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined) requireThat(layer.layout['text-font'] !== undefined, 'text layer requires packaged font');
			}
			checkFontReferences(style.layers);
			let normal: Record<string, unknown> | undefined;
			for (const density of [1, 2] as const) {
				const stem = `sprites/${theme}${density === 2 ? '@2x' : ''}`;
				const indexAsset = assets.get(`${stem}.json`), imageAsset = assets.get(`${stem}.png`);
				requireThat(indexAsset?.kind === 'sprite-index' && indexAsset.theme === theme && indexAsset.density === density &&
					imageAsset?.kind === 'sprite-image' && imageAsset.theme === theme && imageAsset.density === density, 'missing sprite descriptors');
				const index = await json(`${stem}.json`);
				const bitmap = await createImageBitmap(await files.asset(generation, `${stem}.png`));
				try {
					requireThat(Object.keys(index).length > 0, 'empty sprite atlas');
					for (const [name, entry] of Object.entries(index)) {
						const sprite = object(entry);
						requireThat(['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(sprite[key])) &&
							Number(sprite.x) >= 0 && Number(sprite.y) >= 0 && Number(sprite.width) > 0 && Number(sprite.height) > 0 &&
							Number(sprite.x) + Number(sprite.width) <= bitmap.width && Number(sprite.y) + Number(sprite.height) <= bitmap.height && sprite.pixelRatio === density, 'invalid sprite atlas rectangle');
						if (normal) {
							const first = object(normal[name]);
							requireThat(Number(first.width) * 2 === sprite.width && Number(first.height) * 2 === sprite.height, 'sprite density mismatch');
						}
					}
					if (normal) requireThat(Object.keys(normal).length === Object.keys(index).length, 'sprite density keys mismatch');
					normal = index;
				} finally { bitmap.close(); }
			}
			const icons = new Set(Object.keys(normal!));
			const priorIcons = themeIcons;
			if (priorIcons) requireThat(icons.size === priorIcons.size && [...icons].every(name => priorIcons.has(name)), 'sprite theme keys mismatch');
			themeIcons = icons;
		}
		let glyphCount = 0;
		for (const stack of FONT_STACKS) for (let start = 0; start < 65536; start += 256) {
			requireThat(assets.get(`fonts/${encodeURIComponent(stack)}/${start}-${start + 255}.pbf`)?.kind === 'glyph', 'missing glyph descriptor');
			glyphCount++;
		}
		requireThat(manifest.assets.filter(asset => asset.kind === 'glyph').length === glyphCount, 'unexpected glyph descriptor');
		for (const [lon, lat] of Object.values(PLACES)) for (const z of new Set([manifest.nativeZoom.min, Math.min(10, manifest.nativeZoom.max), manifest.nativeZoom.max])) {
			signal.throwIfAborted();
			const x = Math.floor((lon + 180) / 360 * 2 ** z);
			const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z);
			const tile = await archive.getZxy(z, x, y);
			requireThat(tile && tile.data.byteLength > 0, 'representative tile missing');
		}
		signal.throwIfAborted();
	};
}
