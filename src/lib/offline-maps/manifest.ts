/** Package protocol, independent of app releases, MapLibre code and browser storage. */
export interface MapProfile {
	renderer: 'maplibre';
	tileSchema: string;
	style: string;
}

/** Trusted application policy. Never populate this from the downloaded manifest itself. */
export interface ManifestReader {
	version: number;
	allowedOrigins: readonly string[];
	profiles: readonly MapProfile[];
}

export interface PackageFile {
	/** Canonical relative URL path: literal @2x, percent-encoded spaces, no traversal. */
	path: string;
	bytes: number;
	sha256: string;
}

type Theme = 'light' | 'dark';
export type PackageAsset = PackageFile & (
	| { kind: 'glyph' | 'license' }
	| { kind: 'style'; theme: Theme }
	| { kind: 'sprite-index' | 'sprite-image'; theme: Theme; density: 1 | 2 }
);

export interface OfflineMapManifest {
	schemaVersion: 1;
	regionId: string;
	version: string;
	dataDate: string;
	/** West, south, east, north. V1 packages do not cross the antimeridian. */
	bounds: [number, number, number, number];
	nativeZoom: { min: number; max: number };
	compatibility: MapProfile & { minReaderVersion: number; maxReaderVersion: number };
	/** Immutable HTTPS directory ending in /regionId/version/. */
	baseUrl: string;
	archive: PackageFile;
	assets: PackageAsset[];
	/** Archive + all assets; excludes the separately versioned application shell. */
	totalBytes: number;
	/** Text rendered as text, never HTML. Local license files are part of the package. */
	attributions: { text: string; url: string; licensePath: string }[];
}

// Deliberately bounded for regional packages. Fetchers must enforce MAX_MANIFEST_BYTES
// before JSON parsing; checking this object cannot limit the size of its original body.
export const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ASSETS = 4096;
const MAX_PACKAGE_BYTES = 2 * 1024 ** 3;
const MAX_ASSET_BYTES = 32 * 1024 ** 2;
const MERCATOR_LATITUDE = 85.05112878;

function invalid(field: string): never {
	throw new Error(`Invalid offline map manifest: ${field}`);
}

function object(value: unknown, field: string, keys: string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
	const result = value as Record<string, unknown>;
	if (Object.keys(result).some(key => !keys.includes(key))) invalid(`${field}: unknown field`);
	return result;
}

function text(value: unknown, field: string, max = 200): string {
	if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(field);
	return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid(field);
	return value;
}

function identifier(value: unknown, field: string): string {
	const result = text(value, field, 100);
	if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(result) || ['latest', 'current'].includes(result)) invalid(field);
	return result;
}

function path(value: unknown, field: string): string {
	const result = text(value, field, 512);
	// A single encoding convention avoids cache-key aliases (%40 vs @) and encoded
	// separators/traversal. Font stack spaces use %20; executable formats are excluded below.
	if (result.split('/').some(segment => !/^[a-zA-Z0-9_@.-]+(?:%20[a-zA-Z0-9_@.-]+)*$/.test(segment)
		|| segment === '.' || segment === '..')) invalid(field);
	return result;
}

function httpsUrl(value: unknown, field: string): URL {
	const raw = text(value, field, 2048);
	let parsed: URL;
	try { parsed = new URL(raw); } catch { invalid(field); }
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.href !== raw) invalid(field);
	return parsed;
}

function file(value: Record<string, unknown>, field: string, maxBytes: number): PackageFile {
	const sha256 = text(value.sha256, `${field}.sha256`, 64);
	if (!/^[a-f0-9]{64}$/.test(sha256)) invalid(`${field}.sha256`);
	return {
		path: path(value.path, `${field}.path`),
		bytes: integer(value.bytes, `${field}.bytes`, 1, maxBytes),
		sha256
	};
}

function theme(value: unknown, field: string): Theme {
	if (value !== 'light' && value !== 'dark') invalid(field);
	return value;
}

function asset(value: unknown, index: number): PackageAsset {
	const field = `assets[${index}]`;
	const item = object(value, field, ['kind', 'path', 'bytes', 'sha256', 'theme', 'density']);
	const common = file(item, field, MAX_ASSET_BYTES);
	const kind = item.kind;
	if (kind === 'glyph' || kind === 'license') {
		if ('theme' in item || 'density' in item) invalid(field);
		if (!(kind === 'glyph' ? /\.pbf$/ : /\.(txt|md)$/).test(common.path)) invalid(`${field}.path`);
		return { ...common, kind };
	}
	if (kind === 'style') {
		if ('density' in item || !common.path.endsWith('.json')) invalid(field);
		return { ...common, kind, theme: theme(item.theme, `${field}.theme`) };
	}
	if (kind === 'sprite-index' || kind === 'sprite-image') {
		if (!common.path.endsWith(kind === 'sprite-index' ? '.json' : '.png')) invalid(`${field}.path`);
		return { ...common, kind, theme: theme(item.theme, `${field}.theme`), density: integer(item.density, `${field}.density`, 1, 2) as 1 | 2 };
	}
	return invalid(`${field}.kind`);
}

function checkStyleAssets(assets: PackageAsset[]) {
	if (!assets.some(item => item.kind === 'glyph')) invalid('assets: missing glyphs');
	for (const styleTheme of ['light', 'dark'] as const) {
		if (assets.filter(item => item.kind === 'style' && item.theme === styleTheme).length !== 1) invalid(`assets: ${styleTheme} style`);
		let base = '';
		for (const density of [1, 2] as const) {
			const indexes = assets.filter(item => item.kind === 'sprite-index' && item.theme === styleTheme && item.density === density);
			const images = assets.filter(item => item.kind === 'sprite-image' && item.theme === styleTheme && item.density === density);
			if (indexes.length !== 1 || images.length !== 1) invalid(`assets: ${styleTheme} ${density}x sprites`);
			const stem = indexes[0].path.slice(0, -5);
			if (images[0].path !== `${stem}.png`) invalid('assets: sprite index/image paths');
			if (density === 1) base = stem;
			else if (stem !== `${base}@2x`) invalid('assets: retina sprite path');
		}
	}
}

/**
 * Validates untrusted descriptor data against trusted reader capabilities. No I/O.
 * This does NOT verify file hashes/content, PMTiles headers, glyph coverage or URLs
 * inside style JSON. Pipeline/installer must validate those before activating a package,
 * enforce response/redirect origins and never execute package-supplied code.
 */
export function parseOfflineMapManifest(value: unknown, reader: ManifestReader): OfflineMapManifest {
	const source = object(value, 'manifest', ['schemaVersion', 'regionId', 'version', 'dataDate', 'bounds', 'nativeZoom', 'compatibility', 'baseUrl', 'archive', 'assets', 'totalBytes', 'attributions']);
	if (source.schemaVersion !== 1) invalid('schemaVersion');
	const regionId = identifier(source.regionId, 'regionId');
	const version = identifier(source.version, 'version');
	const dataDate = text(source.dataDate, 'dataDate', 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate) || !Number.isFinite(Date.parse(dataDate)) || new Date(dataDate).toISOString().slice(0, 10) !== dataDate) invalid('dataDate');
	if (!Array.isArray(source.bounds) || source.bounds.length !== 4 || Array.from(source.bounds).some(n => typeof n !== 'number' || !Number.isFinite(n))) invalid('bounds');
	const bounds = [...source.bounds] as [number, number, number, number];
	const [west, south, east, north] = bounds;
	if (west < -180 || east > 180 || west >= east || south < -MERCATOR_LATITUDE || north > MERCATOR_LATITUDE || south >= north) invalid('bounds');
	const zoom = object(source.nativeZoom, 'nativeZoom', ['min', 'max']);
	const nativeZoom = { min: integer(zoom.min, 'nativeZoom.min', 0, 24), max: integer(zoom.max, 'nativeZoom.max', 0, 24) };
	if (nativeZoom.min > nativeZoom.max) invalid('nativeZoom');

	const compatible = object(source.compatibility, 'compatibility', ['minReaderVersion', 'maxReaderVersion', 'renderer', 'tileSchema', 'style']);
	const minReaderVersion = integer(compatible.minReaderVersion, 'compatibility.minReaderVersion', 1, 1000);
	const maxReaderVersion = integer(compatible.maxReaderVersion, 'compatibility.maxReaderVersion', minReaderVersion, 1000);
	if (!Number.isSafeInteger(reader.version) || reader.version < minReaderVersion || reader.version > maxReaderVersion) invalid('compatibility: reader version');
	if (compatible.renderer !== 'maplibre') invalid('compatibility.renderer');
	const compatibility: OfflineMapManifest['compatibility'] = {
		minReaderVersion, maxReaderVersion, renderer: 'maplibre',
		tileSchema: text(compatible.tileSchema, 'compatibility.tileSchema'),
		style: text(compatible.style, 'compatibility.style')
	};
	if (!reader.profiles.some(profile => profile.renderer === compatibility.renderer && profile.tileSchema === compatibility.tileSchema && profile.style === compatibility.style)) invalid('compatibility: unsupported profile');

	const base = httpsUrl(source.baseUrl, 'baseUrl');
	if (!reader.allowedOrigins.includes(base.origin) || !base.pathname.endsWith(`/${regionId}/${version}/`)) invalid('baseUrl');
	path(base.pathname.slice(1, -1), 'baseUrl.path');
	const archive = file(object(source.archive, 'archive', ['path', 'bytes', 'sha256']), 'archive', MAX_PACKAGE_BYTES);
	if (!archive.path.endsWith('.pmtiles')) invalid('archive.path');
	if (!Array.isArray(source.assets) || source.assets.length === 0 || source.assets.length > MAX_ASSETS) invalid('assets');
	const assets = Array.from(source.assets, asset);
	const paths = new Set([archive.path]);
	for (const item of assets) {
		if (paths.has(item.path)) invalid('assets: duplicate path');
		paths.add(item.path);
	}
	checkStyleAssets(assets);
	const totalBytes = integer(source.totalBytes, 'totalBytes', 1, MAX_PACKAGE_BYTES);
	if (archive.bytes + assets.reduce((sum, item) => sum + item.bytes, 0) !== totalBytes) invalid('totalBytes: inconsistent sum');
	if (!Array.isArray(source.attributions) || source.attributions.length === 0 || source.attributions.length > 32) invalid('attributions');
	const attributions = Array.from(source.attributions, (value, index) => {
		const field = `attributions[${index}]`;
		const item = object(value, field, ['text', 'url', 'licensePath']);
		const licensePath = path(item.licensePath, `${field}.licensePath`);
		if (!assets.some(asset => asset.kind === 'license' && asset.path === licensePath)) invalid(`${field}.licensePath`);
		return { text: text(item.text, `${field}.text`, 1000), url: httpsUrl(item.url, `${field}.url`).href, licensePath };
	});
	return { schemaVersion: 1, regionId, version, dataDate, bounds, nativeZoom, compatibility, baseUrl: base.href, archive, assets, totalBytes, attributions };
}
