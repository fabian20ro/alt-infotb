import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOfflineMapManifest, type OfflineMapManifest } from '../src/lib/offline-maps/manifest.ts';
import { readerFor } from '../tools/pmtiles/src/profile.ts';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const defaultPackageDirectory = path.join(projectRoot, 'tools/pmtiles/out/bucuresti-ilfov/20261106-v1');
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Synthetic update uses the exact validated payload and changes only immutable identity. */
export function revisionManifest(manifest: OfflineMapManifest, revision: number): OfflineMapManifest {
	if (![1, 2].includes(revision)) throw new Error('Invalid PREVIEW_PACKAGE_REVISION');
	const version = `${manifest.dataDate.replaceAll('-', '')}-v${revision}`;
	return { ...manifest, version, baseUrl: new URL(`../${version}/`, manifest.baseUrl).href };
}

export async function readLocalPackage(directory = process.env.PMTILES_PACKAGE_DIR ?? defaultPackageDirectory) {
	const root = await realpath(directory);
	const original = await readFile(path.join(root, 'manifest.json'));
	const raw = JSON.parse(original.toString()) as OfflineMapManifest;
	const publicRoot = new URL('../../', raw.baseUrl).href;
	const reader = readerFor(publicRoot);
	const manifest = parseOfflineMapManifest(raw, reader);
	const revisions = new Map<string, { manifest: OfflineMapManifest; bytes: Buffer }>();
	revisions.set(manifest.version, { manifest, bytes: original });
	for (const revision of [1, 2]) {
		const next = revisionManifest(manifest, revision);
		if (!revisions.has(next.version)) revisions.set(next.version, { manifest: next, bytes: Buffer.from(`${JSON.stringify(next, null, 2)}\n`) });
	}
	return { root, original, manifest, publicRoot, reader, revisions };
}
