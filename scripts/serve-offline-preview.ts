import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, readLocalPackage } from './offline-preview-package.ts';

const local = await readLocalPackage();
const port = Number(process.env.PORT ?? 4190);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const base = '/alt-infotb/';
const packagePrefix = `${base}__offline_downloads__/`;
const buildDirectory = process.env.PREVIEW_BUILD_DIR ?? 'build-offline';
const pointer = process.env.PREVIEW_BUILD_POINTER;
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
	'.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
	'.pmtiles': 'application/vnd.pmtiles', '.pbf': 'application/x-protobuf', '.txt': 'text/plain', '.ico': 'image/x-icon' };
async function buildRoot() {
	const name = pointer ? (await readFile(path.resolve(projectRoot, pointer), 'utf8')).trim() : buildDirectory;
	if (!['build-offline', 'build-offline-next'].includes(name)) throw new Error('Unexpected offline preview build');
	return realpath(path.join(projectRoot, name));
}
await buildRoot();
const server = createServer((request, response) => { void (async () => {
	response.setHeader('X-Content-Type-Options', 'nosniff');
	response.setHeader('Cache-Control', 'no-store');
	if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.writeHead(405).end(); return; }
	const url = new URL(request.url ?? '/', 'http://localhost');
	if (url.pathname === '/__preview_health') { response.writeHead(200).end('local offline preview'); return; }
	let bytes: Buffer | undefined;
	let filename: string;
	if (url.pathname.startsWith(packagePrefix)) {
		if (url.search) { response.writeHead(404).end(); return; }
		const parts = url.pathname.slice(packagePrefix.length).split('/');
		const version = local.revisions.get(parts.shift()!);
		if (!version) { response.writeHead(404).end(); return; }
		const relative = parts.join('/');
		if (relative === 'manifest.json') { bytes = version.bytes; filename = 'manifest.json'; }
		else {
			if (![local.manifest.archive, ...local.manifest.assets].some(file => file.path === relative)) { response.writeHead(404).end(); return; }
			filename = await realpath(path.join(local.root, decodeURIComponent(relative)));
			if (!filename.startsWith(`${local.root}${path.sep}`)) throw new Error('Escaped package directory');
		}
	} else {
		if (!url.pathname.startsWith(base)) { response.writeHead(404).end(); return; }
		const root = await buildRoot();
		const relative = decodeURIComponent(url.pathname.slice(base.length) || 'index.html');
		filename = await realpath(path.resolve(root, relative));
		if (!filename.startsWith(`${root}${path.sep}`)) throw new Error('Escaped build directory');
	}
	const size = bytes ? bytes.byteLength : (await stat(filename)).size;
	response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream', 'Content-Length': size });
	if (request.method === 'HEAD') { response.end(); return; }
	if (bytes) { response.end(bytes); return; }
	const stream = createReadStream(filename);
	stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
})().catch(() => { if (response.headersSent) response.destroy(); else response.writeHead(404).end(); }); });
// Hard-coded loopback: this tool cannot publish to the LAN or production.
server.listen(port, '127.0.0.1', () => console.log(`App offline preview: http://localhost:${port}${base}`));
