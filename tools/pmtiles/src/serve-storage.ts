import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validatePackage } from './content.ts';
import { readerFor } from './profile.ts';
import type { OfflineMapManifest } from '../../../src/lib/offline-maps/manifest.ts';

const toolsRoot = fileURLToPath(new URL('../', import.meta.url));
const directory = path.resolve(process.env.PMTILES_PACKAGE_DIR ?? path.join(toolsRoot, 'out/bucuresti-ilfov/20261106-v1'));
const dist = await realpath(path.join(toolsRoot, 'dist-storage'));
const packageRoot = await realpath(directory);
const original = await readFile(path.join(packageRoot, 'manifest.json'));
const manifest = JSON.parse(original.toString()) as OfflineMapManifest;
// The local operator chooses this package directory; never trust a downloaded manifest's own hash.
await validatePackage(packageRoot, readerFor(new URL('../../', manifest.baseUrl).href),
	{ pmtilesCli: process.env.PMTILES_CLI ?? path.join(toolsRoot, '.bin/pmtiles') });
// Synthetic update fixture: identical validated payload, only version and immutable URL change.
const next: OfflineMapManifest = { ...manifest, version: `${manifest.dataDate.replaceAll('-', '')}-v2`,
	baseUrl: new URL(`../${manifest.dataDate.replaceAll('-', '')}-v2/`, manifest.baseUrl).href };
const versions = new Map([
	[manifest.version, { manifest, bytes: original }],
	[next.version, { manifest: next, bytes: Buffer.from(`${JSON.stringify(next, null, 2)}\n`) }]
]);
const offers = [...versions.values()].map(item => ({ manifestUrl: new URL('manifest.json', item.manifest.baseUrl).href,
	manifestSha256: createHash('sha256').update(item.bytes).digest('hex') }));
const config = Buffer.from(JSON.stringify({ publicRoot: new URL('../../', manifest.baseUrl).href,
	regionId: manifest.regionId, offers, versions: [...versions.keys()] }));
const port = Number(process.env.PORT ?? 4187);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
	'.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
	'.pmtiles': 'application/vnd.pmtiles', '.pbf': 'application/x-protobuf', '.txt': 'text/plain' };

const server = createServer((request, response) => { void (async () => {
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.setHeader('Cache-Control', 'no-store');
	if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405).end(); return; }
	const url = new URL(request.url ?? '/', 'http://localhost');
	let bytes: Buffer | undefined;
	let filename: string | undefined;
	if (url.pathname === '/config.json') bytes = config;
	else if (url.pathname.startsWith('/package/')) {
		const parts = url.pathname.slice('/package/'.length).split('/');
		const version = versions.get(parts.shift()!);
		if (!version) { response.writeHead(404).end(); return; }
		const relative = parts.join('/');
		if (relative === 'manifest.json') bytes = version.bytes;
		else {
			if (![manifest.archive, ...manifest.assets].some(file => file.path === relative)) { response.writeHead(404).end(); return; }
			filename = await realpath(path.join(packageRoot, decodeURIComponent(relative)));
			if (!filename.startsWith(`${packageRoot}${path.sep}`)) throw new Error('Escaped package');
		}
	} else {
		const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
		filename = await realpath(path.resolve(dist, `.${relative}`));
		if (!filename.startsWith(`${dist}${path.sep}`)) throw new Error('Escaped shell');
	}
	const size = bytes ? bytes.byteLength : (await stat(filename!)).size;
	response.writeHead(200, { 'Content-Type': bytes ? 'application/json' : mime[path.extname(filename!)] ?? 'application/octet-stream', 'Content-Length': size });
	if (request.method === 'HEAD') { response.end(); return; }
	if (bytes) { response.end(bytes); return; }
	const stream = createReadStream(filename!);
	stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
})().catch(() => { if (response.headersSent) response.destroy(); else response.writeHead(404).end(); }); });
server.listen(port, '127.0.0.1', () => console.log(`Persistent package preview: http://localhost:${port}/`));
