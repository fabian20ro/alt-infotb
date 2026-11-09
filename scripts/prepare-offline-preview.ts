import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validatePackage } from '../tools/pmtiles/src/content.ts';
import { digest, projectRoot, readLocalPackage, revisionManifest } from './offline-preview-package.ts';

// This is a local operator command, not a remotely supplied catalog trust decision.
const local = await readLocalPackage();
await validatePackage(local.root, local.reader, {
	pmtilesCli: process.env.PMTILES_CLI ?? path.join(projectRoot, 'tools/pmtiles/.bin/pmtiles')
});
const revision = Number(process.env.PREVIEW_PACKAGE_REVISION ?? local.manifest.version.match(/-v(\d+)$/)?.[1]);
const selectedManifest = revisionManifest(local.manifest, revision);
const selected = local.revisions.get(selectedManifest.version) ?? {
	manifest: selectedManifest, bytes: Buffer.from(`${JSON.stringify(selectedManifest, null, 2)}\n`)
};
const output = path.join(projectRoot, '.offline-preview');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'config.json'), `${JSON.stringify({
	publicRoot: local.publicRoot,
	regionId: local.manifest.regionId,
	offers: [{ manifestUrl: new URL('manifest.json', selected.manifest.baseUrl).href, manifestSha256: digest(selected.bytes) }],
	versions: [selected.manifest.version]
}, null, 2)}\n`);
console.log(`Prepared local-only offline preview: ${selected.manifest.version}, ${selected.manifest.totalBytes} bytes`);
