import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolsRoot = fileURLToPath(new URL('../', import.meta.url));
const mime = (filename: string): string => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
	'.png': 'image/png', '.svg': 'image/svg+xml', '.pbf': 'application/x-protobuf', '.pmtiles': 'application/vnd.pmtiles',
	'.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' }[path.extname(filename)] ?? 'application/octet-stream');

/** A local test server, deliberately separate from Vite/STB and production hosting. */
export function createPreviewServer(options: { directory: string; publicRoot: string; port: number; manifestUrl?: string }) {
	const rootUrl = new URL(options.publicRoot);
	if (rootUrl.protocol !== 'https:' || rootUrl.username || rootUrl.password || rootUrl.search || rootUrl.hash) throw new Error('Expected HTTPS public root');
	if (options.manifestUrl) {
		const source = new URL(options.manifestUrl);
		if (source.origin !== rootUrl.origin || !source.href.startsWith(rootUrl.href) || source.search || source.hash || !source.pathname.endsWith('/manifest.json')) throw new Error('Remote manifest must be under the trusted public root');
	}
	const allowedOrigins = new Set([`http://localhost:${options.port}`, `http://127.0.0.1:${options.port}`]);
	const etags = new Map<string, { size: number; mtime: number; tag: string }>();
	async function handle(request: IncomingMessage, response: ServerResponse) {
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('Vary', 'Origin');
		if (request.headers.origin && allowedOrigins.has(request.headers.origin)) {
			response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
			response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
			response.setHeader('Access-Control-Allow-Headers', 'Range, If-Range, If-Match, If-None-Match');
			response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag');
		}
		if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
		if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD, OPTIONS'); response.writeHead(405); response.end(); return; }
		const url = new URL(request.url ?? '/', 'http://localhost');
		if (url.pathname === '/config.json') {
			const body = JSON.stringify({ publicRoot: options.publicRoot, manifestUrl: options.manifestUrl ?? '/package/manifest.json' });
			response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
			response.end(request.method === 'HEAD' ? undefined : body); return;
		}
		const packageRequest = url.pathname.startsWith('/package/');
		const root = await realpath(packageRequest ? options.directory : path.join(toolsRoot, 'dist-preview'));
		const relative = decodeURIComponent(packageRequest ? url.pathname.slice('/package/'.length) : url.pathname.slice(1) || 'index.html');
		if (relative.includes('\0') || relative.split('/').some(part => part === '..' || part === '.')) { response.writeHead(400); response.end(); return; }
		const filename = await realpath(path.resolve(root, relative));
		if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end(); return; }
		const info = await stat(filename);
		if (!info.isFile()) { response.writeHead(404); response.end(); return; }
		let cached = etags.get(filename);
		if (!cached || cached.size !== info.size || cached.mtime !== info.mtimeMs) {
			const hash = createHash('sha256');
			for await (const chunk of createReadStream(filename)) hash.update(chunk);
			cached = { size: info.size, mtime: info.mtimeMs, tag: `"${hash.digest('hex')}"` }; etags.set(filename, cached);
		}
		response.setHeader('Content-Type', mime(filename));
		response.setHeader('ETag', cached.tag);
		response.setHeader('Accept-Ranges', 'bytes');
		response.setHeader('Cache-Control', packageRequest ? 'public, max-age=31536000, immutable' : 'no-store');
		if (request.headers['if-none-match'] === cached.tag) { response.writeHead(304); response.end(); return; }
		if (request.headers['if-match'] && request.headers['if-match'] !== '*' && request.headers['if-match'] !== cached.tag) { response.writeHead(412); response.end(); return; }
		let start = 0, end = info.size - 1, partial = false;
		const range = request.headers.range;
		if (range && (!request.headers['if-range'] || request.headers['if-range'] === cached.tag)) {
			const match = /^bytes=(\d*)-(\d*)$/.exec(range);
			const invalid = () => { response.setHeader('Content-Range', `bytes */${info.size}`); response.writeHead(416); response.end(); };
			if (!match || (!match[1] && !match[2]) || info.size === 0) { invalid(); return; }
			if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) { invalid(); return; } start = Math.max(0, info.size - suffix); }
			else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
			if (![start, end].every(Number.isSafeInteger) || start >= info.size || end < start) { invalid(); return; }
			partial = true; response.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
		}
		response.setHeader('Content-Length', Math.max(0, end - start + 1));
		response.writeHead(partial ? 206 : 200);
		if (request.method === 'HEAD' || info.size === 0) { response.end(); return; }
		const stream = createReadStream(filename, { start, end });
		stream.on('error', () => response.destroy());
		response.on('close', () => stream.destroy());
		stream.pipe(response);
	}
	return createServer((request, response) => { void handle(request, response).catch(error => {
		if (response.headersSent) { response.destroy(); return; }
		const code = (error as NodeJS.ErrnoException).code;
		response.writeHead(code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 400); response.end();
	}); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const port = Number(process.env.PORT ?? 4186);
	if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid PORT');
	const directory = path.resolve(process.env.PMTILES_PACKAGE_DIR ?? path.join(toolsRoot, 'out/bucuresti-ilfov/20261106-v1'));
	await readFile(path.join(directory, 'manifest.json')); // Fail early instead of serving a broken harness.
	const server = createPreviewServer({ directory, port,
		publicRoot: process.env.PMTILES_PUBLIC_ROOT ?? 'https://pmtiles-preview.invalid/packages/',
		manifestUrl: process.env.PMTILES_MANIFEST_URL });
	server.listen(port, '127.0.0.1', () => console.log(`PMTiles preview: http://localhost:${port}/`));
}
