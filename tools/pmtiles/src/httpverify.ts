import { createHash } from 'node:crypto';
import type { OfflineMapManifest, PackageFile } from '../../../src/lib/offline-maps/manifest.ts';

export type Fetcher = typeof fetch;
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const LATEST_CACHE_CONTROL = 'public, max-age=60, must-revalidate';

export function contentType(path: string): string {
	if (path.endsWith('.pmtiles')) return 'application/vnd.pmtiles';
	if (path.endsWith('.json')) return 'application/json';
	if (path.endsWith('.png')) return 'image/png';
	if (path.endsWith('.pbf')) return 'application/x-protobuf';
	if (path.endsWith('.md')) return 'text/markdown';
	if (path.endsWith('.txt')) return 'text/plain';
	throw new Error(`Unsupported package file type: ${path}`);
}

export function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Stream verification: the public endpoint must return exactly the declared bytes. */
export async function verifyBody(response: Response, file: Pick<PackageFile, 'bytes' | 'sha256'>): Promise<void> {
	if (!response.body) throw new Error('Object body missing');
	const reader = response.body.getReader();
	const hash = createHash('sha256');
	let bytes = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > file.bytes) throw new Error('Object exceeds declared size');
			hash.update(chunk.value);
		}
		if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw new Error('Object size or SHA256 mismatch');
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
	if (!response.body) throw new Error('Object body missing');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > limit) throw new Error('Object exceeds read limit');
			chunks.push(chunk.value);
		}
		return Buffer.concat(chunks);
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

function cors(headers: Headers, origin: string) {
	if (![origin, '*'].includes(headers.get('access-control-allow-origin') ?? '')) throw new Error('Public object CORS origin missing');
	const exposed = (headers.get('access-control-expose-headers') ?? '').toLowerCase().split(',').map(s => s.trim());
	for (const name of ['etag', 'content-range']) {
		if (!exposed.includes(name) && !exposed.includes('*')) throw new Error(`Public CORS does not expose ${name}`);
	}
}

function identity(headers: Headers) {
	const encoding = headers.get('content-encoding');
	if (encoding && encoding !== 'identity') throw new Error('Object representation was transformed');
}

function etag(headers: Headers): string {
	const value = headers.get('etag');
	if (!value || !/^"[^"\r\n]+"$/.test(value)) throw new Error('Strong ETag missing');
	return value;
}

function metadata(response: Response, file: PackageFile, origin: string): string {
	cors(response.headers, origin);
	identity(response.headers);
	if (response.headers.get('content-type')?.split(';')[0] !== contentType(file.path)) throw new Error('Public Content-Type mismatch');
	if (Number(response.headers.get('content-length')) !== file.bytes) throw new Error('Public Content-Length mismatch');
	const cache = (response.headers.get('cache-control') ?? '').toLowerCase().split(',').map(token => token.trim());
	if (!cache.includes('immutable') || !cache.includes('max-age=31536000')) throw new Error('Immutable cache policy missing');
	return etag(response.headers);
}

async function request(fetcher: Fetcher, url: URL, init: RequestInit): Promise<Response> {
	// Redirects can silently send requests to an unapproved host or representation.
	return fetcher(url, { ...init, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(90_000) });
}

/** Check each file's actual public bytes, then HTTP/CORS contracts needed by readers. */
export async function verifyPublicPackage(
	manifest: OfflineMapManifest,
	manifestFile: PackageFile,
	origins: readonly string[],
	readArchiveRange: (start: number, length: number) => Promise<Uint8Array>,
	fetcher: Fetcher = fetch
): Promise<{ files: number; bytes: number }> {
	if (!origins.length || origins.some(origin => new URL(origin).origin !== origin)) throw new Error('Explicit canonical browser origins required');
	const files = [manifest.archive, ...manifest.assets, manifestFile];
	const origin = origins[0];
	let cursor = 0;
	let failed = false;
	const results = await Promise.allSettled(Array.from({ length: 4 }, async () => {
		while (!failed && cursor < files.length) {
			const file = files[cursor++];
			try {
				const response = await request(fetcher, new URL(file.path, manifest.baseUrl), { headers: { Origin: origin } });
				if (response.status !== 200) { await response.body?.cancel(); throw new Error(`Public object GET failed (${response.status}): ${file.path}`); }
				try { metadata(response, file, origin); } catch (error) { await response.body?.cancel(); throw error; }
				await verifyBody(response, file);
			} catch (error) { failed = true; throw error; }
		}
	}));
	const failure = results.find(result => result.status === 'rejected');
	if (failure?.status === 'rejected') throw failure.reason;

	const archive = manifest.archive;
	const archiveUrl = new URL(archive.path, manifest.baseUrl);
	for (const browserOrigin of origins) {
		const head = await request(fetcher, archiveUrl, { method: 'HEAD', headers: { Origin: browserOrigin } });
		if (head.status !== 200) throw new Error('Public archive HEAD failed');
		const versionTag = metadata(head, archive, browserOrigin);
		const preflight = await request(fetcher, archiveUrl, { method: 'OPTIONS', headers: {
			Origin: browserOrigin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range,if-range'
		} });
		try {
			if (!preflight.ok) throw new Error('CORS preflight failed');
			if (![browserOrigin, '*'].includes(preflight.headers.get('access-control-allow-origin') ?? '')) throw new Error('CORS preflight origin missing');
			const methods = (preflight.headers.get('access-control-allow-methods') ?? '').toUpperCase().split(',').map(s => s.trim());
			if (!methods.includes('GET') || !methods.includes('HEAD')) throw new Error('CORS GET/HEAD not allowed');
			const allowed = (preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',').map(s => s.trim());
			if (!allowed.includes('*') && (!allowed.includes('range') || !allowed.includes('if-range'))) throw new Error('CORS Range/If-Range not allowed');
		} finally { await preflight.body?.cancel(); }
		const count = Math.min(127, archive.bytes - 1);
		const middle = Math.floor((archive.bytes - count - 1) / 2);
		const ranges = [[0, count], [middle, middle + count], [archive.bytes - count - 1, archive.bytes - 1]];
		for (const [start, end] of ranges) {
			const response = await request(fetcher, archiveUrl, { headers: { Origin: browserOrigin, Range: `bytes=${start}-${end}`, 'If-Range': versionTag } });
			try {
				if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${archive.bytes}`) throw new Error('Range response mismatch');
				cors(response.headers, browserOrigin); identity(response.headers);
				if (response.headers.get('content-type')?.split(';')[0] !== contentType(archive.path)) throw new Error('Range Content-Type mismatch');
				if (etag(response.headers) !== versionTag || Number(response.headers.get('content-length')) !== end - start + 1) throw new Error('Range metadata mismatch');
				const bytes = await readBounded(response, end - start + 1);
				if (sha256(bytes) !== sha256(await readArchiveRange(start, end - start + 1))) throw new Error('Range bytes mismatch');
			} finally { if (!response.bodyUsed) await response.body?.cancel(); }
		}
		const suffixLength = Math.min(64, archive.bytes);
		const suffix = await request(fetcher, archiveUrl, { headers: { Origin: browserOrigin, Range: `bytes=-${suffixLength}` } });
		try {
			if (suffix.status !== 206 || suffix.headers.get('content-range') !== `bytes ${archive.bytes - suffixLength}-${archive.bytes - 1}/${archive.bytes}`) throw new Error('Suffix range mismatch');
			cors(suffix.headers, browserOrigin); identity(suffix.headers);
			if (suffix.headers.get('content-type')?.split(';')[0] !== contentType(archive.path)) throw new Error('Suffix Content-Type mismatch');
			if (etag(suffix.headers) !== versionTag || Number(suffix.headers.get('content-length')) !== suffixLength) throw new Error('Suffix metadata mismatch');
			const bytes = await readBounded(suffix, suffixLength);
			if (sha256(bytes) !== sha256(await readArchiveRange(archive.bytes - suffixLength, suffixLength))) throw new Error('Suffix bytes mismatch');
		} finally { if (!suffix.bodyUsed) await suffix.body?.cancel(); }
		const unsatisfiable = await request(fetcher, archiveUrl, { headers: { Origin: browserOrigin, Range: `bytes=${archive.bytes}-` } });
		try {
			if (unsatisfiable.status !== 416 || unsatisfiable.headers.get('content-range') !== `bytes */${archive.bytes}`) throw new Error('Unsatisfiable range response mismatch');
			cors(unsatisfiable.headers, browserOrigin);
		} finally { await unsatisfiable.body?.cancel(); }
		const stale = await request(fetcher, archiveUrl, { headers: { Origin: browserOrigin, Range: 'bytes=0-15', 'If-Range': '"pmtiles-deliberately-stale"' } });
		if (stale.status !== 200) { await stale.body?.cancel(); throw new Error('Stale If-Range must return full object'); }
		try { metadata(stale, archive, browserOrigin); } catch (error) { await stale.body?.cancel(); throw error; }
		await verifyBody(stale, archive);
	}
	return { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}
