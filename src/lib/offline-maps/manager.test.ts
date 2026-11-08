import { describe, expect, it, vi } from 'vitest';
import { emptyJournal, type Generation, type Journal, type LockLease, type Locks, type ManagerConfig, type ManagerPorts, type PackageOffer } from './contracts.ts';
import { parseJournal } from './journal.ts';
import { createOfflineMapManager } from './manager.ts';
import { parseOfflineMapManifest, type OfflineMapManifest, type PackageAsset } from './manifest.ts';

const config: ManagerConfig = { namespace: '/alt-infotb/pmtiles-storage-preview/', regionId: 'bucuresti-ilfov', reader: {
	version: 1, allowedOrigins: ['https://maps.example.test'],
	profiles: [{ renderer: 'maplibre', tileSchema: 'test-v1', style: 'test-v1' }]
} };
function fixture(version: string): OfflineMapManifest {
	const common = { bytes: 4, sha256: 'a'.repeat(64) };
	const assets: PackageAsset[] = [{ ...common, kind: 'glyph', path: 'fonts/font/0-255.pbf' }, { ...common, kind: 'license', path: 'license.txt' }];
	for (const theme of ['light', 'dark'] as const) {
		assets.push({ ...common, kind: 'style', theme, path: `${theme}.json` });
		for (const density of [1, 2] as const) for (const [kind, ext] of [['sprite-index', '.json'], ['sprite-image', '.png']] as const) {
			assets.push({ ...common, kind, theme, density, path: `sprites/${theme}${density === 2 ? '@2x' : ''}${ext}` });
		}
	}
	return parseOfflineMapManifest({ schemaVersion: 1, regionId: config.regionId, version, dataDate: '2026-11-06',
		bounds: [25.8, 44.19, 26.49, 44.8], nativeZoom: { min: 0, max: 15 },
		compatibility: { ...config.reader.profiles[0], minReaderVersion: 1, maxReaderVersion: 1 },
		baseUrl: `https://maps.example.test/${config.regionId}/${version}/`,
		archive: { ...common, path: 'basemap.pmtiles' }, assets, totalBytes: 4 * (1 + assets.length),
		attributions: [{ text: 'Fixture', url: 'https://maps.example.test/', licensePath: 'license.txt' }]
	}, config.reader);
}
const offers = Object.fromEntries(['a', 'b', 'c'].map((key) => [key, {
	manifestUrl: `https://maps.example.test/${key}/manifest.json`, manifestSha256: key.repeat(64)
}])) as Record<'a' | 'b' | 'c', PackageOffer>;
const abort = () => new DOMException('Cancelled', 'AbortError');
function gate() {
	let enter!: () => void, release!: () => void;
	const entered = new Promise<void>(resolve => { enter = resolve; });
	const released = new Promise<void>(resolve => { release = resolve; });
	return { entered, release, async wait() { enter(); await released; } };
}

/** FIFO shared/exclusive locks, including abortable queued acquisition. */
class MemoryLocks implements Locks {
	private states = new Map<string, { holders: Set<'shared' | 'exclusive'>; readers: number; queue: Array<{
		mode: 'shared' | 'exclusive'; grant: () => void; signal?: AbortSignal; onAbort: () => void
	}> }>();
	async acquire(name: string, mode: 'shared' | 'exclusive', options: { ifAvailable?: boolean; signal?: AbortSignal } = {}): Promise<LockLease | null> {
		options.signal?.throwIfAborted();
		let state = this.states.get(name);
		if (!state) { state = { holders: new Set(), readers: 0, queue: [] }; this.states.set(name, state); }
		const s = state;
		const fits = (next: 'shared' | 'exclusive') => !s.holders.size || (next === 'shared' && !s.holders.has('exclusive'));
		const drain = () => {
			while (s.queue.length && fits(s.queue[0].mode)) {
				const next = s.queue.shift()!;
				next.signal?.removeEventListener('abort', next.onAbort);
				next.grant();
				if (next.mode === 'exclusive') break;
			}
		};
		if (options.ifAvailable && (s.queue.length || !fits(mode))) return null;
		return new Promise<LockLease>((resolve, reject) => {
			const item = { mode, signal: options.signal, onAbort: () => {
				s.queue = s.queue.filter(entry => entry !== item); reject(options.signal?.reason ?? abort()); drain();
			}, grant: () => {
				s.holders.add(mode); if (mode === 'shared') s.readers++;
				let released = false;
				resolve({ async release() {
					if (released) return; released = true;
					if (mode === 'exclusive' || --s.readers === 0) s.holders.delete(mode);
					drain();
				} });
			} };
			s.queue.push(item); options.signal?.addEventListener('abort', item.onAbort, { once: true }); drain();
		});
	}
}

type Saved = { journal: Journal; files: Map<string, Map<string, Uint8Array>> };
function environment(saved?: Saved) {
	let journal = parseJournal(saved?.journal, config), serial = 0;
	const files = saved ? structuredClone(saved.files) : new Map<string, Map<string, Uint8Array>>();
	const checkpoints: Saved[] = [];
	const save = () => ({ journal: structuredClone(journal), files: structuredClone(files) });
	const faults = {
		quota: Infinity, usage: 0, stream: false, write: false, validate: false, shell: true, remove: false,
		manifest: false, dropBus: false, metadata: false,
		validateGate: null as ReturnType<typeof gate> | null,
		manifestGate: null as ReturnType<typeof gate> | null,
	};
	const listeners = new Set<() => void>();
	const requests = vi.fn(async () => 'not-granted' as const);
	const ports: ManagerPorts = {
		metadata: {
			async read() { return parseJournal(journal, config); },
			async change(update) {
				if (faults.metadata) { faults.metadata = false; throw new Error('IDB transaction failed'); }
				// No await between read and commit: mirrors one serial IDB transaction.
				journal = parseJournal(update(parseJournal(journal, config)), config);
				checkpoints.push(save()); return parseJournal(journal, config);
			}
		},
		files: {
			async create(g) { if (files.has(g.id)) throw new Error('Generation exists'); files.set(g.id, new Map()); checkpoints.push(save()); },
			async write(g, file, stream, signal) {
				const parts: number[] = [];
				for await (const part of stream) {
					signal.throwIfAborted(); parts.push(...part);
					if (faults.write) throw new DOMException('Quota exceeded mid-write', 'QuotaExceededError');
				}
				files.get(g.id)!.set(file.path, Uint8Array.from(parts)); checkpoints.push(save());
			},
			async inspect(g) { return [g.manifest.archive, ...g.manifest.assets].every(f => files.get(g.id)?.get(f.path)?.byteLength === f.bytes); },
			async archive(g) { const data = files.get(g.id)?.get(g.manifest.archive.path); if (!data) throw new Error('Missing archive'); return new Blob([new Uint8Array(data)]); },
			async asset(g, path) { const data = files.get(g.id)?.get(path); if (!data) throw new Error('Missing asset'); return new Blob([new Uint8Array(data)]); },
			async remove(g) { if (faults.remove) throw new Error('Storage temporarily unavailable'); files.delete(g.id); checkpoints.push(save()); }
		},
		locks: new MemoryLocks(),
		storage: { async estimate() { return { usage: faults.usage, quota: faults.quota }; }, async persisted() { return 'not-granted'; }, requestPersistence: requests },
		transport: {
			async manifest(offer, reader, signal) {
				await faults.manifestGate?.wait(); signal.throwIfAborted();
				if (faults.manifest) throw new Error('Manifest hash mismatch');
				const key = Object.entries(offers).find(([, item]) => item.manifestUrl === offer.manifestUrl)?.[0];
				if (!key || offer.manifestSha256 !== offers[key as keyof typeof offers].manifestSha256) throw new Error('Untrusted offer');
				return parseOfflineMapManifest(fixture(`20261106-${key}`), reader);
			},
			async *file(g, file, signal) {
				signal.throwIfAborted(); yield new Uint8Array(file.bytes).fill(g.manifest.version.charCodeAt(g.manifest.version.length - 1));
				// Verification finishes at stream EOF, after the sink has seen bytes.
				if (faults.stream) throw new Error('File hash mismatch');
			}
		},
		bus: { publish() { if (!faults.dropBus) for (const listener of listeners) listener(); }, subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; } },
		async validate(_generation, signal) { await faults.validateGate?.wait(); signal.throwIfAborted(); if (faults.validate) throw new Error('Invalid PMTiles/style closure'); },
		async shellReady() { return faults.shell; }, newId() { return `operation-${++serial}`; }
	};
	const manager = () => createOfflineMapManager(config, ports);
	return { manager, ports, files, faults, checkpoints, requests, save };
}
async function confirmed(env: ReturnType<typeof environment>, key: keyof typeof offers = 'a') {
	const manager = env.manager(); await manager.install(offers[key]);
	const active = (await manager.snapshot()).active!;
	expect(await manager.confirmRendered(active.id)).toBe(true);
	return { manager, active };
}

describe('offline package lifecycle', () => {
	it('installs all files, requires render confirmation, and requests persistence only explicitly', async () => {
		const env = environment(), manager = env.manager();
		expect((await manager.snapshot()).availability).toBe('absent');
		await manager.install(offers.a);
		const s = await manager.snapshot();
		expect(s).toMatchObject({ availability: 'ready', pendingRender: true, persistence: 'not-granted', operation: 'idle' });
		expect(env.files.get(s.active!.id)?.size).toBe(13);
		expect(env.requests).not.toHaveBeenCalled();
		const reader = await manager.openActiveReader();
		expect([...new Uint8Array(await (await reader.archive()).arrayBuffer())]).toEqual([97, 97, 97, 97]);
		expect((await reader.asset('license.txt')).size).toBe(4);
		expect(() => reader.asset('../other-app')).toThrow('Undeclared asset');
		await reader.close();
		expect(() => reader.archive()).toThrow('Reader has closed');
		await manager.confirmRendered(s.active!.id);
		await manager.install(offers.a);
		expect((await manager.snapshot()).active!.id).toBe(s.active!.id);
		expect(await manager.requestPersistence()).toBe('not-granted');
		expect(env.requests).toHaveBeenCalledOnce();
	});

	it('keeps old readers valid across updates; blocks a third generation until deferred cleanup finishes', async () => {
		const env = environment(), { manager, active: a } = await confirmed(env);
		const reader = await manager.openActiveReader();
		await manager.install(offers.b);
		const b = (await manager.snapshot()).active!;
		expect((await manager.snapshot()).previous?.id).toBe(a.id);
		await expect(manager.install(offers.c)).rejects.toMatchObject({ code: 'busy' });
		await manager.confirmRendered(b.id);
		expect(await manager.snapshot()).toMatchObject({ previous: null, operation: 'cleanup-deferred', pendingDeletionCount: 1 });
		expect(await (await reader.archive()).text()).toBe('aaaa');
		await expect(manager.install(offers.c)).rejects.toMatchObject({ code: 'busy' });
		expect(env.files.size).toBe(2);
		await reader.close();
		expect(env.files.has(a.id)).toBe(false);
		await manager.install(offers.c);
		expect((await manager.snapshot()).active!.manifest.version).toBe('20261106-c');
	});

	it('rolls back failed rendering and ignores stale confirmation/rejection callbacks', async () => {
		const env = environment(), { manager, active: a } = await confirmed(env);
		await manager.install(offers.b); const b = (await manager.snapshot()).active!;
		expect(await manager.confirmRendered(a.id)).toBe(false);
		expect(await manager.rejectRendered(b.id)).toBe(true);
		expect(await manager.snapshot()).toMatchObject({ active: a, previous: null, availability: 'ready', pendingRender: false });
		expect(await manager.confirmRendered(b.id)).toBe(false);
		expect(await manager.rejectRendered(b.id)).toBe(false);
		expect(env.files.has(b.id)).toBe(false);
	});

	it('repairs the same version using a new generation and never retains rejected data as fallback', async () => {
		const env = environment(), manager = env.manager();
		await manager.install(offers.a); const a = (await manager.snapshot()).active!;
		await manager.rejectRendered(a.id);
		expect((await manager.snapshot()).availability).toBe('damaged');
		await expect(manager.openActiveReader()).rejects.toMatchObject({ code: 'damaged' });
		await manager.install(offers.a, undefined, { repair: true });
		const replacement = (await manager.snapshot()).active!;
		expect(replacement.id).not.toBe(a.id);
		expect(replacement.manifest.version).toBe(a.manifest.version);
		expect((await manager.snapshot()).previous).toBeNull();
		await manager.confirmRendered(replacement.id);
		expect([...env.files.keys()]).toEqual([replacement.id]);
	});

	it('deletes logically immediately but preserves an open reader until its lease closes', async () => {
		const env = environment(), { manager, active } = await confirmed(env);
		const reader = await manager.openActiveReader();
		await manager.remove();
		expect(await manager.snapshot()).toMatchObject({ availability: 'absent', operation: 'deleting', pendingDeletionCount: 1 });
		expect(await (await reader.archive()).text()).toBe('aaaa');
		await expect(manager.openActiveReader()).rejects.toMatchObject({ code: 'damaged' });
		await reader.close();
		expect(env.files.has(active.id)).toBe(false);
		expect(await manager.snapshot()).toMatchObject({ availability: 'absent', operation: 'idle', pendingDeletionCount: 0 });
		await manager.remove();
		expect(env.files.size).toBe(0);
	});

	it('retries deferred deletion when its last reader closes while region cleanup still owns the mutation lock', async () => {
		const env = environment(), { manager, active } = await confirmed(env);
		const reader = await manager.openActiveReader(), skippedReader = gate();
		const acquire = env.ports.locks.acquire.bind(env.ports.locks);
		let cleanupPaused = false, retried!: () => void;
		const retryRequested = new Promise<void>(resolve => { retried = resolve; });
		env.ports.locks.acquire = async (name, mode, options) => {
			if (cleanupPaused && name.endsWith(':mutation')) retried();
			const lease = await acquire(name, mode, options);
			if (!lease && name.endsWith(`:generation:${active.id}`) && mode === 'exclusive') {
				cleanupPaused = true;
				await skippedReader.wait();
			}
			return lease;
		};
		const deletion = manager.remove();
		await skippedReader.entered;
		const closing = reader.close();
		await retryRequested; // The reader released its shared lease; deletion still holds mutation.
		skippedReader.release();
		await Promise.all([deletion, closing]);
		expect(env.files.has(active.id)).toBe(false);
		expect(await manager.snapshot()).toMatchObject({ availability: 'absent', operation: 'idle', pendingDeletionCount: 0 });
	});

	for (const file of ['archive', 'asset'] as const) it(`durably marks the confirmed generation damaged after a reader ${file} failure`, async () => {
		const env = environment(), { manager, active } = await confirmed(env);
		const reader = await manager.openActiveReader();
		const path = file === 'archive' ? active.manifest.archive.path : 'license.txt';
		const data = env.files.get(active.id)!.get(path)!;
		env.files.get(active.id)!.delete(path);
		await expect(file === 'archive' ? reader.archive() : reader.asset(path)).rejects.toThrow('Missing');
		// Same-sized bytes returning later do not erase an observed integrity failure.
		env.files.get(active.id)!.set(path, data);
		expect((await env.ports.metadata.read()).invalidActive).toBe(true);
		expect((await manager.snapshot()).availability).toBe('damaged');
		await expect(manager.openActiveReader()).rejects.toMatchObject({ code: 'damaged' });
		await reader.close();
	});

	it('does not mark the new generation damaged when an old leased reader fails', async () => {
		const env = environment(), { manager, active: a } = await confirmed(env);
		const old = await manager.openActiveReader();
		await manager.install(offers.b); const b = (await manager.snapshot()).active!;
		await manager.confirmRendered(b.id);
		env.files.get(a.id)!.delete(a.manifest.archive.path);
		await expect(old.archive()).rejects.toThrow('Missing archive');
		expect((await env.ports.metadata.read()).invalidActive).toBe(false);
		expect(await manager.snapshot()).toMatchObject({ active: b, availability: 'ready' });
		await old.close();
	});

	it('preserves rollback when a reader discovers corruption during render confirmation', async () => {
		const env = environment(), { manager, active: a } = await confirmed(env);
		await manager.install(offers.b); const b = (await manager.snapshot()).active!;
		const reader = await manager.openActiveReader(), shell = gate();
		env.ports.shellReady = async () => { await shell.wait(); return true; };
		const confirmation = manager.confirmRendered(b.id);
		await shell.entered;
		const data = env.files.get(b.id)!.get('license.txt')!;
		env.files.get(b.id)!.delete('license.txt');
		await expect(reader.asset('license.txt')).rejects.toThrow('Missing asset');
		env.files.get(b.id)!.set('license.txt', data);
		shell.release();
		expect(await confirmation).toBe(false);
		expect(await manager.snapshot()).toMatchObject({ active: b, previous: a, availability: 'damaged', pendingRender: true });
		expect(env.files.has(a.id)).toBe(true);
		expect(await manager.rejectRendered(b.id)).toBe(true);
		await reader.close();
		expect(await manager.snapshot()).toMatchObject({ active: a, previous: null, availability: 'ready', pendingRender: false });
	});
});

describe('offline package failure boundaries', () => {
	for (const failure of ['quota', 'write', 'stream', 'validate', 'shell', 'manifest', 'metadata'] as const) {
		it(`retains the confirmed package after ${failure} failure`, async () => {
			const env = environment(), { manager, active } = await confirmed(env);
			if (failure === 'quota') env.faults.quota = 1;
			else if (failure === 'shell') env.faults.shell = false;
			else env.faults[failure] = true;
			await expect(manager.install(offers.b)).rejects.toThrow();
			expect(await manager.snapshot()).toMatchObject({ active, availability: 'ready', previous: null, operation: 'idle', pendingDeletionCount: 0 });
			expect([...env.files.keys()]).toEqual([active.id]);
			expect((await env.ports.metadata.read()).candidate).toBeNull();
		});
	}

	it('honors cancellation from another tab even when all broadcast notifications are lost', async () => {
		const env = environment(), { manager, active } = await confirmed(env), other = env.manager();
		env.faults.dropBus = true; env.faults.validateGate = gate();
		const install = manager.install(offers.b);
		const rejection = expect(install).rejects.toMatchObject({ name: 'AbortError' });
		await env.faults.validateGate.entered;
		await other.cancel();
		expect((await env.ports.metadata.read()).operation?.cancelled).toBe(true);
		env.faults.validateGate.release(); await rejection;
		expect(await manager.snapshot()).toMatchObject({ active, availability: 'ready', operation: 'idle' });
		expect([...env.files.keys()]).toEqual([active.id]);
	});

	it('journals cancellation before the manifest has arrived', async () => {
		const env = environment(), manager = env.manager(), other = env.manager();
		env.faults.dropBus = true; env.faults.manifestGate = gate();
		const rejection = expect(manager.install(offers.a)).rejects.toMatchObject({ name: 'AbortError' });
		await env.faults.manifestGate.entered; await other.cancel();
		expect(await env.ports.metadata.read()).toMatchObject({ candidate: null, operation: { cancelled: true } });
		env.faults.manifestGate.release(); await rejection;
		expect(env.files.size).toBe(0);
		expect((await manager.snapshot()).operation).toBe('idle');
	});

	it('retains a durable deletion record when physical cleanup fails and retries on recovery', async () => {
		const env = environment(), { manager, active } = await confirmed(env);
		env.faults.validate = true; env.faults.remove = true;
		await expect(manager.install(offers.b)).rejects.toThrow('Invalid PMTiles');
		expect(await manager.snapshot()).toMatchObject({ active, availability: 'ready', operation: 'cleanup-deferred', pendingDeletionCount: 1 });
		env.faults.remove = false; await manager.recover();
		expect([...env.files.keys()]).toEqual([active.id]);
		expect((await manager.snapshot()).operation).toBe('idle');
	});

	it('serializes deletion behind a cancelled installer without activating the candidate', async () => {
		const env = environment(), { manager } = await confirmed(env), other = env.manager();
		env.faults.validateGate = gate();
		const rejected = expect(manager.install(offers.b)).rejects.toMatchObject({ name: 'AbortError' });
		await env.faults.validateGate.entered;
		const removed = other.remove();
		await vi.waitFor(async () => { expect((await env.ports.metadata.read()).operation?.cancelled).toBe(true); });
		env.faults.validateGate.release(); await rejected; await removed;
		expect(await manager.snapshot()).toMatchObject({ availability: 'absent', operation: 'idle' });
		expect(env.files.size).toBe(0);
	});

	it('aborts a queued installer on disposal without cancelling another tab owner', async () => {
		const env = environment(), owner = env.manager(), queued = env.manager();
		env.faults.validateGate = gate();
		const first = owner.install(offers.a); await env.faults.validateGate.entered;
		const second = expect(queued.install(offers.b)).rejects.toMatchObject({ name: 'AbortError' });
		await queued.dispose(); await second;
		env.faults.validateGate.release(); await first;
		expect((await owner.snapshot()).active!.manifest.version).toBe('20261106-a');
	});
});

describe('offline journal restart recovery', () => {
	it('recovers at every metadata commit and file write boundary around an update', async () => {
		const env = environment(), { manager, active: a } = await confirmed(env);
		env.checkpoints.length = 0;
		await manager.install(offers.b);
		const b = (await manager.snapshot()).active!;
		expect(env.checkpoints.length).toBeGreaterThan(15);
		for (const cut of env.checkpoints) {
			const restart = environment(cut), recovered = restart.manager();
			await recovered.recover();
			const state = await recovered.snapshot();
			if (cut.journal.active?.id === b.id) {
				expect(state).toMatchObject({ active: b, previous: a, pendingRender: true, availability: 'ready' });
				await recovered.confirmRendered(b.id);
				expect([...restart.files.keys()]).toEqual([b.id]);
			} else {
				expect(state).toMatchObject({ active: a, previous: null, pendingRender: false, availability: 'ready', operation: 'idle' });
				expect([...restart.files.keys()]).toEqual([a.id]);
			}
			expect((await restart.ports.metadata.read()).candidate).toBeNull();
		}
	});

	it('rolls back an activated generation whose files disappeared before confirmation', async () => {
		const env = environment(), { manager, active: a } = await confirmed(env);
		await manager.install(offers.b); const b = (await manager.snapshot()).active!;
		env.files.delete(b.id); await manager.recover();
		expect(await manager.snapshot()).toMatchObject({ active: a, previous: null, pendingRender: false, availability: 'ready' });
		expect([...env.files.keys()]).toEqual([a.id]);
	});

	it('clears a missing fallback and marks a rejected active package damaged', async () => {
		const env = environment(), { manager, active: a } = await confirmed(env);
		await manager.install(offers.b); const b = (await manager.snapshot()).active!;
		env.files.delete(a.id); await manager.rejectRendered(b.id);
		expect(await manager.snapshot()).toMatchObject({ active: b, previous: null, pendingRender: false, availability: 'damaged', pendingDeletionCount: 0 });
	});

	for (const action of ['confirmation', 'deletion'] as const) it(`finishes interrupted ${action} at every physical deletion and journal commit`, async () => {
		const env = environment(), { manager } = await confirmed(env);
		await manager.install(offers.b); const b = (await manager.snapshot()).active!;
		env.checkpoints.length = 0;
		if (action === 'confirmation') await manager.confirmRendered(b.id);
		else await manager.remove();
		for (const cut of env.checkpoints) {
			const restart = environment(cut), recovered = restart.manager();
			await recovered.recover();
			const state = await recovered.snapshot();
			// remove() first records cancellation; a crash before its deletion
			// transaction retains the still-valid package and fallback.
			if (action === 'deletion' && cut.journal.active) {
				expect(state.active?.id).toBe(b.id);
				await recovered.remove();
			} else expect(state).toMatchObject({ availability: action === 'confirmation' ? 'ready' : 'absent', operation: 'idle', pendingDeletionCount: 0 });
			expect([...restart.files.keys()]).toEqual(action === 'confirmation' ? [b.id] : []);
		}
	});

	it('repairs an evicted active archive without reusing its physical generation', async () => {
		const env = environment(), { manager, active } = await confirmed(env);
		env.files.get(active.id)!.delete(active.manifest.archive.path);
		expect((await manager.snapshot()).availability).toBe('damaged');
		await manager.recover();
		await manager.install(offers.a, undefined, { repair: true });
		const replacement = (await manager.snapshot()).active!;
		expect(replacement.id).not.toBe(active.id);
		expect((await manager.snapshot()).previous).toBeNull();
		await manager.confirmRendered(replacement.id);
		expect([...env.files.keys()]).toEqual([replacement.id]);
	});

	it('fails closed on a malformed namespace before accessing storage', () => {
		const env = environment();
		const read = vi.spyOn(env.ports.metadata, 'read');
		expect(() => createOfflineMapManager({ ...config, namespace: '/preview/../production/' }, env.ports)).toThrow('Invalid offline map namespace');
		expect(read).not.toHaveBeenCalled();
	});
});
