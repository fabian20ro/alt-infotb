import { emptyJournal, type Generation, type Journal, type ManagerConfig, type ManagerPorts, type PackageOffer, type PackageSnapshot, type ReaderLease } from './contracts.ts';

export class OfflineMapError extends Error {
	readonly code: 'busy' | 'damaged' | 'unsupported' | 'quota' | 'invalid';
	constructor(code: OfflineMapError['code'], message: string) { super(message); this.name = 'OfflineMapError'; this.code = code; }
}
const aborted = () => new DOMException('Offline map operation cancelled', 'AbortError');
const allGenerations = (s: Journal) => [s.active, s.previous, s.candidate, ...s.garbage].filter((g): g is Generation => !!g);

/** No renderer, Svelte or browser globals: cross-store safety lives at this boundary. */
export function createOfflineMapManager(config: ManagerConfig, ports: ManagerPorts) {
	if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(config.namespace) || !/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(config.regionId)) throw new OfflineMapError('invalid', 'Invalid offline map namespace/region');
	const prefix = `offline-maps:${config.namespace}:${config.regionId}:`;
	const listeners = new Set<() => void>();
	let current: { id: string; controller: AbortController } | null = null;
	let progress: PackageSnapshot['progress'] = null;
	let disposed = false;
	const activeCalls = new Set<Promise<unknown>>();
	const controllers = new Set<AbortController>();
	function emit() { for (const listener of listeners) { try { listener(); } catch { /* Observers cannot undo storage commits. */ } } }
	function notify() { emit(); try { ports.bus.publish(); } catch { /* IDB remains authoritative. */ } }
	const unsubscribe = ports.bus.subscribe(() => {
		emit();
		const running = current;
		if (running) void ports.metadata.read().then(s => {
			if (current === running && s.operation?.id === running.id && s.operation.cancelled) running.controller.abort();
		}).catch(() => { running.controller.abort(); });
	});
	function live() { if (disposed) throw new OfflineMapError('unsupported', 'Manager is disposed'); }
	function id() {
		const value = ports.newId();
		if (!/^[a-z0-9-]{1,80}$/.test(value)) throw new OfflineMapError('invalid', 'Invalid generated operation ID');
		return value;
	}
	async function withMutation<T>(action: () => Promise<T>, signal?: AbortSignal, ifAvailable = false): Promise<T | undefined> {
		live();
		const lease = await ports.locks.acquire(`${prefix}mutation`, 'exclusive', { signal, ifAvailable });
		if (!lease) return undefined;
		try { live(); return await action(); } finally { await lease.release(); }
	}
	/** Never wait on a reader while holding the mutation lock: a renderer may need it to confirm. */
	async function cleanupLocked() {
		let s = await ports.metadata.read();
		for (const generation of s.garbage) {
			const lease = await ports.locks.acquire(`${prefix}generation:${generation.id}`, 'exclusive', { ifAvailable: true });
			if (!lease) continue;
			try {
				await ports.files.remove(generation);
				await ports.metadata.change(latest => ({ ...latest, garbage: latest.garbage.filter(g => g.id !== generation.id) }));
			} catch { /* Keep the deletion journal; next recovery/reader release retries it. */ }
			finally { await lease.release(); }
		}
		s = await ports.metadata.read();
		if (s.operation?.phase === 'deleting' && !s.garbage.length) await ports.metadata.change(latest => ({ ...latest, operation: null }));
		notify();
	}
	async function recoverLocked() {
		let s = await ports.metadata.read();
		// Owning mutation proves any journaled installer belongs to a terminated operation.
		if (s.operation && s.operation.phase !== 'deleting') {
			await ports.metadata.change(latest => ({ ...latest, operation: null, candidate: null,
				garbage: latest.candidate ? [...latest.garbage, latest.candidate] : latest.garbage }));
		}
		s = await ports.metadata.read();
		if (s.active && (s.invalidActive || !await ports.files.inspect(s.active))) {
			if (s.previous && await ports.files.inspect(s.previous)) {
				await ports.metadata.change(latest => ({ ...latest, active: latest.previous, previous: null,
					pendingRender: false, invalidActive: false, garbage: [...latest.garbage, latest.active!] }));
			} else await ports.metadata.change(latest => ({ ...latest, invalidActive: true, pendingRender: false }));
		}
		s = await ports.metadata.read();
		if (s.previous && !await ports.files.inspect(s.previous)) {
			await ports.metadata.change(latest => ({ ...latest, previous: null, garbage: [...latest.garbage, latest.previous!] }));
		}
		await cleanupLocked();
	}
	async function snapshot(): Promise<PackageSnapshot> {
		live();
		const s = await ports.metadata.read();
		const intact = s.active && !s.invalidActive && await ports.files.inspect(s.active);
		return { active: s.active, previous: s.previous, pendingRender: s.pendingRender,
			availability: !s.active ? 'absent' : intact ? 'ready' : 'damaged',
			operation: s.operation?.phase ?? (s.garbage.length ? 'cleanup-deferred' : 'idle'),
			pendingDeletionCount: s.garbage.length, progress: progress ? { ...progress } : null,
			persistence: await ports.storage.persisted() };
	}
	async function checkUpdate(offer: PackageOffer, signal = new AbortController().signal) {
		live();
		const manifest = await ports.transport.manifest(offer, config.reader, signal);
		if (manifest.regionId !== config.regionId) throw new OfflineMapError('invalid', 'Offer belongs to another region');
		return { manifest, available: (await ports.metadata.read()).active?.manifestSha256 !== offer.manifestSha256 };
	}
	async function install(offer: PackageOffer, externalSignal?: AbortSignal, options: { repair?: boolean; expectedActiveId?: string | null } = {}) {
		live();
		const controller = new AbortController();
		controllers.add(controller);
		const externalAbort = () => controller.abort(externalSignal?.reason);
		if (externalSignal?.aborted) externalAbort();
		externalSignal?.addEventListener('abort', externalAbort, { once: true });
		const call = withMutation(async () => {
			await recoverLocked();
			let s = await ports.metadata.read();
			// Bind the caller's release-policy decision to the generation observed before
			// queuing. Another tab may have installed and confirmed a newer map meanwhile.
			if (options.expectedActiveId !== undefined && (s.active?.id ?? null) !== options.expectedActiveId) {
				throw new OfflineMapError('busy', 'The active map changed; check the available package again');
			}
			if (s.pendingRender || s.previous || s.garbage.length || s.operation) throw new OfflineMapError('busy', 'Confirm the current map or release old readers before installing another package');
			if (!options.repair && s.active?.manifestSha256 === offer.manifestSha256 && !s.invalidActive && await ports.files.inspect(s.active)) return;
			controller.signal.throwIfAborted();
			const operationId = id();
			current = { id: operationId, controller };
			const assertRunning = (state: Journal) => {
				controller.signal.throwIfAborted();
				if (state.operation?.id !== operationId || state.operation.cancelled) throw aborted();
			};
			try {
				await ports.metadata.change(latest => ({ ...latest, operation: { id: operationId, phase: 'downloading', cancelled: false } }));
				notify();
				const manifest = await ports.transport.manifest(offer, config.reader, controller.signal);
				if (manifest.regionId !== config.regionId) throw new OfflineMapError('invalid', 'Offer belongs to another region');
				const estimate = await ports.storage.estimate();
				const required = manifest.totalBytes + Math.max(16 * 1024 ** 2, Math.ceil(manifest.totalBytes * 0.1));
				if (Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage) && estimate.quota! - estimate.usage! < required) throw new OfflineMapError('quota', 'Insufficient temporary storage; the active map was retained');
				const generation: Generation = { id: `${manifest.version}-${id()}`, manifest, manifestSha256: offer.manifestSha256 };
				await ports.metadata.change(latest => { assertRunning(latest); return { ...latest, candidate: generation }; });
				progress = { bytes: 0, total: manifest.totalBytes }; notify();
				await ports.files.create(generation);
				for (const file of [manifest.archive, ...manifest.assets]) {
					assertRunning(await ports.metadata.read());
					const stream = ports.transport.file(generation, file, controller.signal);
					async function* counted() {
						for await (const bytes of stream) { controller.signal.throwIfAborted(); yield bytes;
							progress!.bytes += bytes.byteLength; emit(); }
					}
					await ports.files.write(generation, file, counted(), controller.signal);
				}
				await ports.metadata.change(latest => { assertRunning(latest); return { ...latest, operation: { ...latest.operation!, phase: 'verifying' } }; });
				notify();
				await ports.validate(generation, controller.signal);
				if (!await ports.files.inspect(generation)) throw new OfflineMapError('damaged', 'Candidate files are incomplete');
				if (!await ports.shellReady()) throw new OfflineMapError('unsupported', 'Consumer shell is not available offline');
				// No file/network work inside this short transaction. Cancellation is checked atomically.
				await ports.metadata.change(latest => {
					assertRunning(latest);
					return { ...latest, previous: latest.invalidActive ? null : latest.active, active: latest.candidate, candidate: null,
						garbage: latest.invalidActive && latest.active ? [...latest.garbage, latest.active] : latest.garbage,
						pendingRender: true, invalidActive: false, operation: null };
				});
				notify();
			} catch (error) {
				// A failed post-commit notification must never undo activation. Only this operation's candidate is abandoned.
				await ports.metadata.change(latest => latest.operation?.id === operationId ? { ...latest, operation: null,
					candidate: null, garbage: latest.candidate ? [...latest.garbage, latest.candidate] : latest.garbage } : latest);
				await cleanupLocked();
				throw error;
			} finally { current = null; progress = null; notify(); }
		}, controller.signal);
		activeCalls.add(call);
		try { await call; } finally { activeCalls.delete(call); controllers.delete(controller); externalSignal?.removeEventListener('abort', externalAbort); }
	}
	async function cancel() {
		live();
		await ports.metadata.change(s => s.operation && s.operation.phase !== 'deleting'
			? { ...s, operation: { ...s.operation, cancelled: true } } : s);
		current?.controller.abort(); notify();
	}
	async function remove() {
		await cancel();
		await withMutation(async () => {
			await ports.metadata.change(s => ({ ...emptyJournal(), garbage: allGenerations(s),
				operation: { id: id(), phase: 'deleting', cancelled: false } }));
			notify(); await cleanupLocked();
		});
	}
	async function confirmRendered(generationId: string): Promise<boolean> {
		return await withMutation(async () => {
			const s = await ports.metadata.read();
			if (s.active?.id !== generationId || !s.pendingRender || s.invalidActive) return false;
			if (!await ports.files.inspect(s.active) || !await ports.shellReady()) throw new OfflineMapError('damaged', 'Installed map or shell is incomplete');
			let confirmed = false;
			await ports.metadata.change(latest => {
				// A reader can report corruption while the asynchronous checks above are running.
				if (latest.active?.id !== generationId || !latest.pendingRender || latest.invalidActive) return latest;
				confirmed = true;
				return { ...latest, previous: null, pendingRender: false,
					garbage: latest.previous ? [...latest.garbage, latest.previous] : latest.garbage };
			});
			if (!confirmed) return false;
			await cleanupLocked(); return true;
		}) ?? false;
	}
	async function rejectRendered(generationId: string): Promise<boolean> {
		return await withMutation(async () => {
			const s = await ports.metadata.read();
			if (s.active?.id !== generationId || !s.pendingRender) return false;
			if (s.previous && await ports.files.inspect(s.previous)) {
				await ports.metadata.change(latest => ({ ...latest, active: latest.previous, previous: null,
					pendingRender: false, invalidActive: false, garbage: [...latest.garbage, latest.active!] }));
			} else await ports.metadata.change(latest => ({ ...latest, pendingRender: false, invalidActive: true, previous: null,
				garbage: latest.previous ? [...latest.garbage, latest.previous] : latest.garbage }));
			await cleanupLocked(); return true;
		}) ?? false;
	}
	async function cleanup() { await withMutation(cleanupLocked, undefined, true); }
	async function recover() { await withMutation(recoverLocked); }
	async function readStored<T>(generation: Generation, read: () => Promise<T>): Promise<T> {
		try { return await read(); }
		catch (error) {
			// A stale reader must not mark its replacement damaged. Preserve any concurrent installer.
			await ports.metadata.change(s => s.active?.id === generation.id ? { ...s, invalidActive: true } : s).catch(() => {});
			notify();
			throw error;
		}
	}
	async function openActiveReader(): Promise<ReaderLease> {
		live();
		for (let attempt = 0; attempt < 4; attempt++) {
			const first = await ports.metadata.read();
			if (!first.active || first.invalidActive) throw new OfflineMapError('damaged', 'No usable active map');
			const generation = first.active;
			const lease = await ports.locks.acquire(`${prefix}generation:${generation.id}`, 'shared');
			if (!lease) throw new OfflineMapError('busy', 'Map reader unavailable');
			try {
				const latest = await ports.metadata.read();
				if (latest.active?.id !== generation.id || latest.invalidActive) { await lease.release(); continue; }
				await readStored(generation, async () => {
					if (!await ports.files.inspect(generation)) throw new OfflineMapError('damaged', 'Installed map files are missing');
				});
				let closed = false;
				const assertOpen = () => { if (closed) throw new OfflineMapError('damaged', 'Reader has closed'); };
				return { generation,
					archive() { assertOpen(); return readStored(generation, () => ports.files.archive(generation)); },
					asset(path) { assertOpen(); if (!generation.manifest.assets.some(a => a.path === path)) throw new OfflineMapError('invalid', 'Undeclared asset'); return readStored(generation, () => ports.files.asset(generation, path)); },
					async close() {
						if (closed) return;
						closed = true; await lease.release();
						// Queue after the current mutation: a try-lock could lose the final cleanup wakeup.
						if (!disposed) await withMutation(cleanupLocked);
					}
				};
			} catch (error) { await lease.release(); throw error; }
		}
		throw new OfflineMapError('busy', 'Active map changed repeatedly');
	}
	return { snapshot, install, checkUpdate, cancel, remove, recover, cleanup, openActiveReader, confirmRendered, rejectRendered,
		subscribe(listener: () => void) { live(); listeners.add(listener); return () => { listeners.delete(listener); }; },
		async requestPersistence() { live(); const result = await ports.storage.requestPersistence(); notify(); return result; },
		async dispose() { if (disposed) return; disposed = true; for (const controller of controllers) controller.abort(); unsubscribe(); listeners.clear(); await Promise.allSettled([...activeCalls]); }
	};
}
