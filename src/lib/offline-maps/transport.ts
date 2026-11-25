import { sha256 } from '@noble/hashes/sha2.js';
import { MAX_MANIFEST_BYTES, parseOfflineMapManifest, type ManifestReader, type PackageFile } from './manifest.ts';
import type { Generation, PackageOffer, PackageTransport } from './contracts.ts';

const hex = (value: Uint8Array): string => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
export const digestBytes = (value: Uint8Array): string => hex(sha256(value));

function requireThat(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Offline package transfer: ${message}`);
}
function trustedUrl(raw: string, reader?: ManifestReader): URL {
	const url = new URL(raw);
	requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.href === raw,
		'expected canonical HTTPS URL without credentials');
	if (reader) requireThat(reader.allowedOrigins.includes(url.origin), 'unapproved origin');
	return url;
}

/** Also bound custom transports/streams which do not themselves listen to AbortSignal. */
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) { void operation.catch(() => {}); signal.throwIfAborted(); }
	let rejectAbort: () => void = () => {};
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectAbort = () => reject(signal.reason);
		signal.addEventListener('abort', rejectAbort, { once: true });
	});
	try { return await Promise.race([operation, aborted]); }
	finally { signal.removeEventListener('abort', rejectAbort); }
}

export function createPackageTransport(options: { fetch?: typeof fetch; timeoutMs?: number } = {}): PackageTransport {
	const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
	const timeoutMs = options.timeoutMs ?? 120_000;
	requireThat(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30 * 60_000, 'invalid timeout');

	async function* transfer(url: URL, maximum: number, caller: AbortSignal, exact?: number): AsyncGenerator<Uint8Array> {
		caller.throwIfAborted();
		const controller = new AbortController();
		const forwardAbort = () => controller.abort(caller.reason);
		caller.addEventListener('abort', forwardAbort, { once: true });
		const timer = setTimeout(() => controller.abort(new DOMException('Package transfer timed out', 'TimeoutError')), timeoutMs);
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		try {
			const pending = fetcher(url.href, { signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
			// A custom preview transport may resolve after cancellation; release its late body too.
			void pending.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}); }).catch(() => {});
			const response = await abortable(pending, controller.signal);
			// Readable bodies are always cancelled below, including rejected HTTP responses.
			if (response.body) reader = response.body.getReader();
			requireThat(response.status === 200 && response.type !== 'opaque' && response.type !== 'opaqueredirect', `HTTP ${response.status}`);
			requireThat(!response.redirected && (!response.url || response.url === url.href), 'redirected response');
			requireThat(reader, 'response body missing');
			const encoding = response.headers.get('content-encoding');
			requireThat(!encoding || encoding === 'identity', 'transformed response');
			const length = response.headers.get('content-length');
			if (length !== null) requireThat(/^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length) > 0 &&
				Number(length) <= maximum && (exact === undefined || Number(length) === exact), 'declared response length mismatch');
			let bytes = 0;
			while (true) {
				const chunk = await abortable(reader.read(), controller.signal);
				if (chunk.done) break;
				requireThat(chunk.value instanceof Uint8Array, 'invalid byte stream');
				bytes += chunk.value.byteLength;
				requireThat(bytes <= maximum, 'response exceeds byte limit');
				if (chunk.value.byteLength) yield chunk.value;
			}
			controller.signal.throwIfAborted();
			requireThat(bytes > 0 && (exact === undefined || bytes === exact) && (length === null || bytes === Number(length)), 'truncated response');
		} finally {
			clearTimeout(timer);
			caller.removeEventListener('abort', forwardAbort);
			// Do not let an underlying custom cancel callback stall cancellation forever.
			if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
			controller.abort();
		}
	}

	return {
		async manifest(offer: PackageOffer, reader: ManifestReader, signal: AbortSignal) {
			requireThat(/^[a-f0-9]{64}$/.test(offer.manifestSha256), 'invalid trusted manifest SHA256');
			const url = trustedUrl(offer.manifestUrl, reader);
			requireThat(url.pathname.endsWith('/manifest.json'), 'expected immutable manifest URL');
			const chunks: Uint8Array[] = [];
			let length = 0;
			for await (const chunk of transfer(url, MAX_MANIFEST_BYTES, signal)) { chunks.push(chunk); length += chunk.byteLength; }
			const bytes = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
			requireThat(digestBytes(bytes) === offer.manifestSha256, 'manifest SHA256 mismatch');
			const manifest = parseOfflineMapManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), reader);
			requireThat(new URL('manifest.json', manifest.baseUrl).href === url.href, 'manifest location does not match immutable base URL');
			return manifest;
		},
		async *file(generation: Generation, file: PackageFile, signal: AbortSignal) {
			const declared = [generation.manifest.archive, ...generation.manifest.assets].find(item => item.path === file.path);
			requireThat(declared && declared.bytes === file.bytes && declared.sha256 === file.sha256, 'undeclared file');
			const base = trustedUrl(generation.manifest.baseUrl);
			const url = new URL(file.path, base);
			requireThat(base.pathname.endsWith('/') && url.href === base.href + file.path, 'file escapes immutable directory');
			requireThat(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 2 * 1024 ** 3 && /^[a-f0-9]{64}$/.test(file.sha256), 'invalid file descriptor');
			const hash = sha256.create();
			try {
				for await (const chunk of transfer(url, file.bytes, signal, file.bytes)) {
					hash.update(chunk);
					yield chunk;
				}
				signal.throwIfAborted();
				requireThat(hex(hash.digest()) === file.sha256, `SHA256 mismatch: ${file.path}`);
			} finally { hash.destroy(); }
		}
	};
}
