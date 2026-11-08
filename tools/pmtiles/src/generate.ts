import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { OfflineMapManifest, PackageAsset } from '../../../src/lib/offline-maps/manifest.ts';
import source from '../source.json' with { type: 'json' };
import { PROFILE, readerFor } from './profile.ts';
import { canonicalPath, checkFile, copyPinned, downloadPinned, filesBelow, hashFile } from './io.ts';
import { validatePackage } from './content.ts';

const run = promisify(execFile);
const toolDirectory = fileURLToPath(new URL('../', import.meta.url));
export interface GenerateOptions {
	publicRoot: string;
	outputRoot: string;
	cacheDirectory: string;
	pmtilesCli?: string;
	/** Previously retained extract; always checked against the source pin. */
	archiveFile?: string;
	archiveUrl?: string;
}

export function createStyle(theme: 'light' | 'dark') {
	const mapLayers = layers('basemap', namedFlavor(theme), { lang: 'ro' });
	for (const layer of mapLayers) {
		// Upstream v4 sprites omit townhall. Preserve its label with the supplied building icon.
		if (layer.type === 'symbol' && layer['source-layer'] === 'pois' && layer.layout?.['icon-image']) {
			const icon = layer.layout['icon-image'];
			if (typeof icon !== 'string' && !Array.isArray(icon)) throw new Error('Unsupported upstream POI icon expression');
			layer.layout['icon-image'] = ['case', ['==', ['get', 'kind'], 'townhall'], 'building', icon];
		}
	}
	return { version: 8, glyphs: 'fonts/{fontstack}/{range}.pbf', sprite: `sprites/${theme}`,
		sources: { basemap: { type: 'vector', url: 'pmtiles://basemap.pmtiles', attribution: '© OpenStreetMap contributors · Protomaps' } }, layers: mapLayers };
}

type AssetKind = PackageAsset extends infer A ? A extends PackageAsset ? Omit<A, 'path' | 'bytes' | 'sha256'> : never : never;
function assetKind(filename: string): AssetKind {
	if (filename.startsWith('fonts/') && filename.endsWith('.pbf')) return { kind: 'glyph' };
	if (filename.endsWith('.txt') || filename.endsWith('.md')) return { kind: 'license' };
	if (filename === 'light.json' || filename === 'dark.json') return { kind: 'style', theme: filename === 'light.json' ? 'light' : 'dark' };
	const sprite = /^sprites\/(light|dark)(@2x)?\.(json|png)$/.exec(filename);
	if (sprite) return { kind: sprite[3] === 'json' ? 'sprite-index' : 'sprite-image', theme: sprite[1] as 'light' | 'dark', density: sprite[2] ? 2 : 1 };
	throw new Error(`Unexpected generated asset: ${filename}`);
}

/** All candidates are complete and validated before their immutable directory appears. */
export async function generatePackage(options: GenerateOptions) {
	const reader = readerFor(options.publicRoot);
	const rootUrl = new URL(options.publicRoot);
	if (!rootUrl.pathname.endsWith('/')) throw new Error('Public root must end in /');
	const baseUrl = new URL(`${source.regionId}/${source.version}/`, rootUrl).href;
	const cli = options.pmtilesCli ?? 'pmtiles';
	const version = (await run(cli, ['version'], { timeout: 10_000 })).stdout.trim();
	if (!version.startsWith(`pmtiles ${source.archive.cliVersion},`)) throw new Error('Pinned pmtiles CLI version required');
	await mkdir(options.cacheDirectory, { recursive: true });
	const parent = path.resolve(options.outputRoot, source.regionId);
	await mkdir(parent, { recursive: true });
	const staging = await mkdtemp(path.join(parent, '.candidate-'));
	const destination = path.join(parent, source.version);
	try {
		const archive = path.join(staging, 'basemap.pmtiles');
		const cachedArchive = path.resolve(options.cacheDirectory, `${source.archive.sha256}.pmtiles`);
		if (options.archiveFile) {
			await checkFile(options.archiveFile, source.archive);
			await copyFile(options.archiveFile, archive);
		} else if (options.archiveUrl) {
			const url = new URL(options.archiveUrl);
			if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('Retained archive must have an HTTPS URL without credentials');
			await downloadPinned(url.href, cachedArchive, source.archive);
			await copyFile(cachedArchive, archive);
		} else {
			let cached = false;
			try { await checkFile(cachedArchive, source.archive); cached = true; }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
			if (cached) await copyFile(cachedArchive, archive);
			else {
				await run(cli, ['extract', source.archive.planetUrl, archive, `--bbox=${source.bounds.join(',')}`, `--maxzoom=${source.nativeZoom.max}`, '--download-threads=4'], { timeout: 30 * 60_000, maxBuffer: 4 * 1024 * 1024 });
				await checkFile(archive, source.archive);
				await copyPinned(archive, cachedArchive, source.archive);
			}
		}
		await checkFile(archive, source.archive);
		const zip = path.resolve(options.cacheDirectory, `${source.assets.sha256}.zip`);
		await downloadPinned(source.assets.url, zip, source.assets);
		await run('python3', [path.join(toolDirectory, 'src/extract-assets.py'), zip, staging, source.assets.commit], { timeout: 60_000 });
		await mkdir(path.join(staging, 'licenses'));
		for (const license of ['ODbL.txt', 'style.txt', 'sprites.txt']) await copyFile(path.join(toolDirectory, 'licenses', license), path.join(staging, 'licenses', license));
		await writeFile(path.join(staging, 'licenses/data.txt'), `Map data: © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright\nTiles: Protomaps ${source.archive.schemaVersion}; source ${source.archive.planetUrl}\nRegional extract SHA256: ${source.archive.sha256}\nBounds: ${source.bounds.join(', ')}\n${source.coverage.description}\nBoundary reference: ${source.coverage.source}\n${source.coverage.attribution}; https://creativecommons.org/licenses/by/4.0/\nStyle: @protomaps/basemaps 5.7.2, Romanian labels; townhall uses building sprite.\nAssets commit: ${source.assets.commit}\n`);
		for (const theme of ['light', 'dark'] as const) await writeFile(path.join(staging, `${theme}.json`), `${JSON.stringify(createStyle(theme), null, 2)}\n`);
		const assets: PackageAsset[] = [];
		for (const filename of await filesBelow(staging)) {
			if (filename === archive) continue;
			const relative = path.relative(staging, filename);
			assets.push({ path: canonicalPath(relative), bytes: (await stat(filename)).size, sha256: await hashFile(filename), ...assetKind(relative) } as PackageAsset);
		}
		const manifest: OfflineMapManifest = {
			schemaVersion: 1, regionId: source.regionId, version: source.version, dataDate: source.dataDate,
			bounds: source.bounds as [number, number, number, number], nativeZoom: source.nativeZoom,
			compatibility: { ...PROFILE, minReaderVersion: 1, maxReaderVersion: 1 }, baseUrl,
			archive: { path: 'basemap.pmtiles', bytes: source.archive.bytes, sha256: source.archive.sha256 }, assets,
			totalBytes: source.archive.bytes + assets.reduce((sum, file) => sum + file.bytes, 0),
			attributions: [
				{ text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', licensePath: 'licenses/ODbL.txt' },
				{ text: 'Protomaps basemap style', url: 'https://protomaps.com/', licensePath: 'licenses/style.txt' },
				{ text: 'Protomaps symbols', url: 'https://github.com/protomaps/basemaps-assets', licensePath: 'licenses/sprites.txt' },
				{ text: 'Noto fonts', url: 'https://fonts.google.com/noto', licensePath: 'fonts/OFL.txt' },
				{ text: source.coverage.attribution, url: 'https://www.geoboundaries.org/', licensePath: 'licenses/data.txt' }
			]
		};
		await writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
		const validated = await validatePackage(staging, reader, { pmtilesCli: cli, expectedCliVersion: source.archive.cliVersion });
		try {
			await stat(destination);
			if (!Buffer.from(await readFile(path.join(destination, 'manifest.json'))).equals(await readFile(path.join(staging, 'manifest.json')))) throw new Error('Immutable package version already exists with different bytes');
			await validatePackage(destination, reader, { pmtilesCli: cli });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			await rename(staging, destination);
		}
		return { directory: destination, ...validated };
	} finally { await rm(staging, { recursive: true, force: true }); }
}
