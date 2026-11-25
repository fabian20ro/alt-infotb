import type { ChangeBus, Generation, GenerationStore, Journal, LockLease, Locks, ManagerConfig, MetadataRepository, Persistence, StoragePolicy } from './contracts.ts';
import type { PackageFile } from './manifest.ts';
import { assertManagerConfig, assertStorageId, parseJournal } from './journal.ts';

const ROOT = 'alt-infotb-offline-v1';
const STORE = 'journal';
const KEY = 'region';
const absent = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
function abort(signal: AbortSignal) { signal.throwIfAborted(); }
function descriptor(generation: Generation, pathname: string): PackageFile {
	const result = [generation.manifest.archive, ...generation.manifest.assets].find(file => file.path === pathname);
	if (!result) throw new Error('Undeclared package file');
	return result;
}
async function digest(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
	return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function boundedBlob(response: Response, maximum: number): Promise<Blob> {
	if (!response.body || maximum > 32 * 1024 * 1024) throw new Error('Invalid installed asset');
	const reader = response.body.getReader();
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let size = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > maximum) throw new Error('Installed asset exceeds declared size');
			chunks.push(new Uint8Array(chunk.value));
		}
		return new Blob(chunks);
	} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export interface BrowserStorage {
	metadata: MetadataRepository;
	files: GenerationStore;
	locks: Locks;
	storage: StoragePolicy;
	bus: ChangeBus;
	close(): void;
}

/** Capability-gated adapter. Importing it has no side effects and never requests persistence. */
export async function createBrowserStorage(config: ManagerConfig): Promise<BrowserStorage> {
	assertManagerConfig(config);
	if (!globalThis.isSecureContext || !globalThis.indexedDB || !globalThis.caches || !navigator.locks ||
		!navigator.storage?.getDirectory || !globalThis.BroadcastChannel || !globalThis.crypto?.subtle) {
		throw new Error('Offline map storage is unavailable in this browser');
	}
	const scope = `${ROOT}:${encodeURIComponent(config.namespace)}:${config.regionId}`;
	const opfs = await navigator.storage.getDirectory();
	const root = await opfs.getDirectoryHandle(ROOT, { create: true });
	const application = await root.getDirectoryHandle(encodeURIComponent(config.namespace), { create: true });
	const region = await application.getDirectoryHandle(config.regionId, { create: true });
	// Presence of getDirectory alone does not establish writable OPFS support.
	const probeName = `.capability-${crypto.randomUUID()}`;
	try {
		const probe = await region.getFileHandle(probeName, { create: true });
		if (typeof probe.createWritable !== 'function') throw new Error('Writable OPFS is unavailable');
		const writable = await probe.createWritable(); await writable.close();
	} finally { await region.removeEntry(probeName).catch(error => { if (!absent(error)) throw error; }); }

	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(scope, 1);
		let blocked = false;
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onerror = () => reject(request.error);
		request.onblocked = () => { blocked = true; reject(new Error('Offline metadata database upgrade blocked')); };
		request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
	});
	db.onversionchange = () => db.close();
	let closed = false;
	function checkOpen() { if (closed) throw new Error('Offline storage adapter closed'); }
	function transaction(update?: (current: Journal) => Journal): Promise<Journal> {
		checkOpen();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, update ? 'readwrite' : 'readonly', update ? { durability: 'strict' } : undefined);
			let result: Journal;
			let failure: unknown;
			tx.onabort = () => reject(failure ?? tx.error ?? new Error('Offline metadata transaction aborted'));
			tx.onerror = () => { failure ??= tx.error; };
			tx.oncomplete = () => resolve(result);
			const store = tx.objectStore(STORE);
			const request = store.get(KEY);
			request.onsuccess = () => {
				try {
					result = parseJournal(request.result, config);
					if (update) {
						result = parseJournal(update(result), config);
						if (!result.active && !result.previous && !result.candidate && !result.operation && !result.garbage.length) store.delete(KEY);
						else store.put(result, KEY);
					}
				} catch (error) { failure = error; tx.abort(); }
			};
		});
	}
	function checkedId(generation: Generation): string {
		assertStorageId(generation.id);
		if (generation.manifest.regionId !== config.regionId) throw new Error('Foreign offline map region');
		return generation.id;
	}
	const cacheName = (generation: Generation) => `${scope}:generation:${checkedId(generation)}`;
	const assetUrl = (generation: Generation, file: PackageFile) => new URL(`${config.namespace}__offline_maps__/${config.regionId}/${checkedId(generation)}/${file.path}`, location.origin).href;
	async function directory(generation: Generation, create = false) { return region.getDirectoryHandle(checkedId(generation), { create }); }
	const archiveName = 'archive.pmtiles';
	const files: GenerationStore = {
		async create(generation) {
			checkOpen();
			try { await directory(generation); throw new Error('Physical generation already exists'); }
			catch (error) { if (!absent(error)) throw error; }
			if (await caches.has(cacheName(generation))) throw new Error('Physical generation cache already exists');
			await directory(generation, true);
			await caches.open(cacheName(generation));
		},
		async write(generation, file, stream, signal) {
			checkOpen(); abort(signal);
			const expected = descriptor(generation, file.path);
			if (expected.bytes !== file.bytes || expected.sha256 !== file.sha256) throw new Error('Package file descriptor changed');
			let bytes = 0;
			if (file.path === generation.manifest.archive.path) {
				const target = await directory(generation);
				try { await target.getFileHandle(archiveName); throw new Error('Immutable archive already exists'); }
				catch (error) { if (!absent(error)) throw error; }
				const handle = await target.getFileHandle(archiveName, { create: true });
				const writable = await handle.createWritable();
				try {
					for await (const chunk of stream) {
						abort(signal); bytes += chunk.byteLength;
						if (bytes > file.bytes) throw new Error('Archive exceeds declared length');
						await writable.write(new Uint8Array(chunk));
					}
					abort(signal); if (bytes !== file.bytes) throw new Error('Truncated archive');
					await writable.close();
				} catch (error) { await writable.abort().catch(() => {}); throw error; }
			} else {
				if (!await caches.has(cacheName(generation))) throw new Error('Candidate cache missing');
				const cache = await caches.open(cacheName(generation));
				if (await cache.match(assetUrl(generation, file))) throw new Error('Immutable asset already exists');
				const chunks: Uint8Array<ArrayBuffer>[] = [];
				for await (const chunk of stream) {
					abort(signal); bytes += chunk.byteLength;
					if (bytes > file.bytes || bytes > 32 * 1024 * 1024) throw new Error('Asset exceeds declared length');
					chunks.push(new Uint8Array(chunk));
				}
				abort(signal); if (bytes !== file.bytes) throw new Error('Truncated asset');
				const blob = new Blob(chunks);
				if (await digest(blob) !== file.sha256) throw new Error('Asset SHA256 mismatch');
				abort(signal);
				await cache.put(assetUrl(generation, file), new Response(blob, { headers: {
					'Content-Length': String(file.bytes), 'X-Offline-SHA256': file.sha256
				} }));
			}
		},
		async inspect(generation) {
			checkOpen();
			try {
				const archive = await (await (await directory(generation)).getFileHandle(archiveName)).getFile();
				if (archive.size !== generation.manifest.archive.bytes || !await caches.has(cacheName(generation))) return false;
				const cache = await caches.open(cacheName(generation));
				for (const file of generation.manifest.assets) {
					const response = await cache.match(assetUrl(generation, file));
					if (!response || Number(response.headers.get('Content-Length')) !== file.bytes || response.headers.get('X-Offline-SHA256') !== file.sha256) return false;
				}
				return true;
			} catch (error) { if (absent(error)) return false; throw error; }
		},
		async archive(generation) {
			checkOpen();
			const file = await (await (await directory(generation)).getFileHandle(archiveName)).getFile();
			if (file.size !== generation.manifest.archive.bytes) throw new Error('Installed archive missing/truncated');
			return file;
		},
		async asset(generation, pathname) {
			checkOpen(); const file = descriptor(generation, pathname);
			if (pathname === generation.manifest.archive.path) throw new Error('Use archive reader for PMTiles');
			if (!await caches.has(cacheName(generation))) throw new Error('Installed asset cache missing');
			const response = await (await caches.open(cacheName(generation))).match(assetUrl(generation, file));
			if (!response) throw new Error('Installed asset missing');
			const blob = await boundedBlob(response, file.bytes);
			if (blob.size !== file.bytes || await digest(blob) !== file.sha256) throw new Error('Installed asset corrupted');
			return blob;
		},
		async remove(generation) {
			checkOpen();
			await region.removeEntry(checkedId(generation), { recursive: true }).catch(error => { if (!absent(error)) throw error; });
			await caches.delete(cacheName(generation));
		}
	};
	const locks: Locks = {
		acquire(name, mode, options = {}) {
			checkOpen();
			return new Promise<LockLease | null>((resolve, reject) => {
				let release!: () => void;
				const held = new Promise<void>(done => { release = done; });
				const request = navigator.locks.request(name, { mode, ...options }, async lock => {
					if (!lock) { resolve(null); return; }
					resolve({ async release() { release(); await request; } });
					await held;
				});
				void request.catch(reject);
			});
		}
	};
	const storage: StoragePolicy = {
		estimate: () => navigator.storage.estimate(),
		async persisted(): Promise<Persistence> {
			if (!navigator.storage.persisted) return 'unavailable';
			try { return await navigator.storage.persisted() ? 'granted' : 'not-granted'; } catch { return 'unavailable'; }
		},
		async requestPersistence(): Promise<Persistence> {
			if (!navigator.storage.persist) return 'unavailable';
			try { await navigator.storage.persist(); return await this.persisted(); } catch { return 'unavailable'; }
		}
	};
	const channel = new BroadcastChannel(scope);
	const listeners = new Set<() => void>();
	channel.onmessage = () => { for (const listener of listeners) { try { listener(); } catch { /* Observers cannot change committed storage. */ } } };
	return { metadata: { read: () => transaction(), change: update => transaction(update) }, files, locks, storage,
		bus: { publish() { checkOpen(); channel.postMessage(null); }, subscribe(listener) { checkOpen(); listeners.add(listener); return () => listeners.delete(listener); } },
		close() { if (closed) return; closed = true; listeners.clear(); channel.close(); db.close(); }
	};
}
