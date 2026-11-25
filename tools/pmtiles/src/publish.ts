import { createReadStream, openAsBlob } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { MAX_MANIFEST_BYTES, parseOfflineMapManifest, type ManifestReader, type PackageFile } from '../../../src/lib/offline-maps/manifest.ts';
import { contentType, IMMUTABLE_CACHE_CONTROL, LATEST_CACHE_CONTROL, readBounded, sha256, verifyBody, verifyPublicPackage, type Fetcher } from './httpverify.ts';

export type WriteCondition = { ifNoneMatch: '*' } | { ifMatch: string };
export interface ObjectMetadata { contentType: string; cacheControl: string; sha256: string }
export interface ObjectStore {
	/** Reads committed storage, not the public CDN. A missing object is null; other errors reject. */
	get(key: string): Promise<Response | null>;
	/** Preconditions must be evaluated atomically with the write. Never emulate with HEAD then PUT. */
	put(key: string, body: Blob, condition: WriteCondition, metadata: ObjectMetadata): Promise<void>;
}
export class PreconditionFailed extends Error {
	constructor() { super('Object changed concurrently'); this.name = 'PreconditionFailed'; }
}

export interface BrowserReceipt {
	schemaVersion: 1;
	manifestSha256: string;
	toolRevision: string;
	passed: true;
	scenarios: number;
	themes: string[];
	pixelRatios: number[];
	offline: true;
}
export interface PublishOptions {
	directory: string;
	validated: { manifestSha256: string };
	reader: ManifestReader;
	receipt: BrowserReceipt;
	toolRevision: string;
	store: ObjectStore;
	corsOrigins: readonly string[];
	fetch?: Fetcher;
}
export interface LatestPointer {
	schemaVersion: 1;
	regionId: string;
	version: string;
	manifestUrl: string;
	manifestSha256: string;
}

function quotedEtag(response: Response): string {
	const tag = response.headers.get('etag');
	if (!tag || !/^"[^"\r\n]+"$/.test(tag)) throw new Error('Committed object ETag missing');
	return tag;
}

async function localFile(directory: string, file: PackageFile): Promise<{ blob: Blob; filename: string }> {
	const root = await realpath(directory);
	const filename = path.resolve(root, decodeURIComponent(file.path));
	if (!filename.startsWith(`${root}${path.sep}`)) throw new Error('Package path escapes directory');
	const parts = path.relative(root, filename).split(path.sep);
	let entry = root;
	for (const part of parts) {
		entry = path.join(entry, part);
		if ((await lstat(entry)).isSymbolicLink()) throw new Error('Package symlink rejected');
	}
	const info = await lstat(filename);
	if (!info.isFile() || info.size !== file.bytes) throw new Error(`Package file size changed: ${file.path}`);
	// Blob tracks file metadata and fails if changed while the streaming upload is read.
	const blob = await openAsBlob(filename, { type: contentType(file.path) });
	const hash = createHash('sha256');
	let bytes = 0;
	for await (const chunk of createReadStream(filename)) {
		bytes += chunk.length;
		if (bytes > file.bytes) throw new Error('Package changed during hashing');
		hash.update(chunk);
	}
	if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw new Error(`Package SHA256 changed: ${file.path}`);
	return { blob, filename };
}

/** Publication ordering is pipeline policy; the shared reader contract stays generic. */
function packageRevision(version: string, dataDate: string): number {
	const match = /^(\d{8})-v([1-9]\d*)$/.exec(version);
	const revision = match ? Number(match[2]) : NaN;
	if (!match || match[1] !== dataDate.replaceAll('-', '') || !Number.isSafeInteger(revision)) {
		throw new Error('Unsupported pipeline version: expected data date YYYYMMDD-vN with a positive safe integer revision');
	}
	return revision;
}

/** Validated artifacts + a matching render receipt are necessary, but not remotely trusted signatures. */
export async function publishPackage(options: PublishOptions): Promise<{ pointer: LatestPointer; uploaded: number; reused: number; verifiedFiles: number }> {
	const manifestPath = path.join(options.directory, 'manifest.json');
	const manifestInfo = await lstat(manifestPath);
	if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > MAX_MANIFEST_BYTES) throw new Error('Invalid manifest file');
	const rawManifest = await readFile(manifestPath);
	if (rawManifest.length > MAX_MANIFEST_BYTES) throw new Error('Manifest changed during reading');
	const manifestSha256 = sha256(rawManifest);
	const manifest = parseOfflineMapManifest(JSON.parse(rawManifest.toString('utf8')), options.reader);
	const revision = packageRevision(manifest.version, manifest.dataDate);
	const receipt = options.receipt;
	if (manifestSha256 !== options.validated.manifestSha256 || !receipt || receipt.schemaVersion !== 1 ||
		receipt.manifestSha256 !== manifestSha256 || !/^[a-f0-9]{40}$/.test(options.toolRevision) || receipt.toolRevision !== options.toolRevision ||
		receipt.passed !== true || receipt.offline !== true || !Number.isSafeInteger(receipt.scenarios) || receipt.scenarios < 84 ||
		!Array.isArray(receipt.themes) || !['light', 'dark'].every(theme => receipt.themes.includes(theme)) ||
		!Array.isArray(receipt.pixelRatios) || ![1, 2].every(ratio => receipt.pixelRatios.includes(ratio))) throw new Error('Matching content validation and browser receipt required');
	const manifestFile = { path: 'manifest.json', bytes: rawManifest.length, sha256: manifestSha256 };
	if ([manifest.archive, ...manifest.assets].some(file => file.path === manifestFile.path)) throw new Error('Manifest cannot be a package asset');
	const keyFor = (relative: string) => decodeURIComponent(new URL(relative, manifest.baseUrl).pathname.slice(1));
	const manifestKey = keyFor('manifest.json');
	const latestUrl = new URL('../latest.json', manifest.baseUrl);
	const latestKey = decodeURIComponent(latestUrl.pathname.slice(1));
	const pointer: LatestPointer = { schemaVersion: 1, regionId: manifest.regionId, version: manifest.version,
		manifestUrl: new URL('manifest.json', manifest.baseUrl).href, manifestSha256 };
	const pointerBytes = Buffer.from(`${JSON.stringify(pointer, null, 2)}\n`);
	const existingLatest = await options.store.get(latestKey);
	let latestCondition: WriteCondition = { ifNoneMatch: '*' };
	if (existingLatest) {
		latestCondition = { ifMatch: quotedEtag(existingLatest) };
		const old = JSON.parse(Buffer.from(await readBounded(existingLatest, MAX_MANIFEST_BYTES)).toString('utf8')) as Partial<LatestPointer>;
		if (old.schemaVersion !== 1 || old.regionId !== manifest.regionId || typeof old.version !== 'string' ||
			typeof old.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(old.manifestSha256) ||
			typeof old.manifestUrl !== 'string') throw new Error('Invalid existing latest pointer');
		if (old.version === manifest.version && old.manifestSha256 !== manifestSha256) throw new Error('Immutable version conflict in latest');
		if (!/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(old.version)) throw new Error('Invalid latest version');
		const oldUrl = new URL(`../${old.version}/manifest.json`, manifest.baseUrl);
		if (old.manifestUrl !== oldUrl.href) throw new Error('Latest references an unexpected manifest location');
		const oldResponse = await options.store.get(decodeURIComponent(oldUrl.pathname.slice(1)));
		if (!oldResponse) throw new Error('Latest manifest missing from committed storage');
		const oldBytes = await readBounded(oldResponse, MAX_MANIFEST_BYTES);
		if (sha256(oldBytes) !== old.manifestSha256) throw new Error('Latest manifest hash mismatch');
		const oldManifest = parseOfflineMapManifest(JSON.parse(Buffer.from(oldBytes).toString('utf8')), options.reader);
		if (oldManifest.version !== old.version || oldManifest.regionId !== manifest.regionId ||
			new URL('manifest.json', oldManifest.baseUrl).href !== old.manifestUrl) throw new Error('Latest manifest identity mismatch');
		const oldRevision = packageRevision(oldManifest.version, oldManifest.dataDate);
		if (manifest.dataDate === oldManifest.dataDate && revision < oldRevision) throw new Error('Refusing to promote an older package revision');
		if (manifest.dataDate < oldManifest.dataDate) throw new Error('Refusing to replace newer map data with an older package');
	}
	// An already-complete version must match before adding any files to its prefix.
	const existingManifest = await options.store.get(manifestKey);
	if (existingManifest) await verifyBody(existingManifest, manifestFile);

	let uploaded = 0;
	let reused = 0;
	async function upload(file: PackageFile) {
		const { blob } = await localFile(options.directory, file);
		const key = keyFor(file.path);
		const existing = await options.store.get(key);
		if (existing) { await verifyBody(existing, file); reused++; return; }
		try {
			await options.store.put(key, blob, { ifNoneMatch: '*' }, { contentType: contentType(file.path), cacheControl: IMMUTABLE_CACHE_CONTROL, sha256: file.sha256 });
			uploaded++;
		} catch (error) {
			if (!(error instanceof PreconditionFailed)) throw error;
			const winner = await options.store.get(key);
			if (!winner) throw new Error('Concurrent immutable write disappeared');
			await verifyBody(winner, file); reused++;
		}
	}
	const files = [manifest.archive, ...manifest.assets];
	let cursor = 0;
	let failed = false;
	const writes = await Promise.allSettled(Array.from({ length: 4 }, async () => {
		while (!failed && cursor < files.length) {
			try { await upload(files[cursor++]); } catch (error) { failed = true; throw error; }
		}
	}));
	const failure = writes.find(result => result.status === 'rejected');
	if (failure?.status === 'rejected') throw failure.reason;
	await upload(manifestFile);
	const archivePath = path.join(options.directory, decodeURIComponent(manifest.archive.path));
	const archive = await open(archivePath, 'r');
	let verified;
	try {
		verified = await verifyPublicPackage(manifest, manifestFile, options.corsOrigins, async (start, length) => {
			const buffer = Buffer.alloc(length);
			const result = await archive.read(buffer, 0, length, start);
			if (result.bytesRead !== length) throw new Error('Local range sample truncated');
			return buffer;
		}, options.fetch);
	} finally { await archive.close(); }
	// The only mutable write. No unconditional fallback or retry after a conflict.
	await options.store.put(latestKey, new Blob([pointerBytes]), latestCondition, {
		contentType: 'application/json', cacheControl: LATEST_CACHE_CONTROL, sha256: sha256(pointerBytes)
	});
	return { pointer, uploaded, reused, verifiedFiles: verified.files };
}
