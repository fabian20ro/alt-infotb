import { describe, expect, it, vi } from 'vitest';
import { createOfflineMapCoordinator, type CoordinatorPorts } from './coordinator.js';
import { createMapScene } from '../map/model.js';
import type { MapCamera, MapRenderer, MapRendererEvents } from '../map/renderer.js';
import type { Generation, PackageOffer, PackageSnapshot, ReaderLease } from './contracts.js';
import type { OfflineMapManifest } from './manifest.js';
import type { createOfflineMapManager } from './manager.js';

const offer: PackageOffer = { manifestUrl: 'https://maps.test/b/manifest.json', manifestSha256: 'b'.repeat(64) };
function generation(id: string): Generation {
	const manifest: OfflineMapManifest = { schemaVersion: 1, regionId: 'bucuresti-ilfov', version: id === 'a' ? '20261106-v1' : '20261106-v2', dataDate: '2026-11-06',
		bounds: [25.8, 44.19, 26.49, 44.8], nativeZoom: { min: 0, max: 15 }, compatibility: {
			renderer: 'maplibre', style: 'test', tileSchema: 'test', minReaderVersion: 1, maxReaderVersion: 1 },
		baseUrl: `https://maps.test/${id}/`, archive: { path: 'a.pmtiles', bytes: 4, sha256: 'a'.repeat(64) }, assets: [],
		totalBytes: 4, attributions: [] };
	return { id, manifest, manifestSha256: id.repeat(64) };
}
const scene = () => createMapScene({ allStations: [], selectedStationId: null, userPosition: null,
	locationPermission: 'prompt', locationError: null, theme: 'light', route: null });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function environment(initial: Generation | null = generation('a')) {
	let snapshot: PackageSnapshot = { availability: initial ? 'ready' : 'absent', active: initial, previous: null, pendingRender: false,
		operation: 'idle', pendingDeletionCount: 0, progress: null, persistence: 'not-granted' };
	const log: string[] = [];
	const listeners = new Set<() => void>();
	const readers: ReaderLease[] = [];
	const manager: ReturnType<typeof createOfflineMapManager> = {
		snapshot: vi.fn(async () => structuredClone(snapshot)),
		install: vi.fn(async () => { log.push('install'); snapshot = { ...snapshot, active: generation('b'), previous: snapshot.active, availability: 'ready', pendingRender: true }; }),
		checkUpdate: vi.fn(async () => ({ manifest: generation('b').manifest, available: snapshot.active?.id !== 'b' })),
		cancel: vi.fn(async () => { log.push('cancel'); }),
		remove: vi.fn(async () => { log.push('remove'); snapshot = { ...snapshot, active: null, previous: null, pendingRender: false, availability: 'absent' }; }),
		recover: vi.fn(async () => {}), cleanup: vi.fn(async () => {}),
		openActiveReader: vi.fn(async () => {
			if (!snapshot.active) throw new Error('No active map');
			const item: ReaderLease = { generation: snapshot.active, archive: async () => new Blob(), asset: async () => new Blob(), close: vi.fn(async () => { log.push(`close:${item.generation.id}`); }) };
			readers.push(item); return item;
		}),
		confirmRendered: vi.fn(async id => {
			if (snapshot.active?.id !== id || !snapshot.pendingRender) return false;
			snapshot = { ...snapshot, pendingRender: false, previous: null }; return true;
		}),
		rejectRendered: vi.fn(async id => {
			if (snapshot.active?.id !== id || !snapshot.pendingRender) return false;
			snapshot = { ...snapshot, active: snapshot.previous, previous: null, pendingRender: false, availability: snapshot.previous ? 'ready' : 'damaged' }; return true;
		}),
		subscribe: vi.fn(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }),
		requestPersistence: vi.fn(async () => { snapshot = { ...snapshot, persistence: 'granted' }; return 'granted' as const; }),
		dispose: vi.fn(async () => { log.push('dispose-manager'); })
	};
	type Engine = { renderer: MapRenderer; events: MapRendererEvents; context: Parameters<CoordinatorPorts['createRenderer']>[3] };
	const engines: Engine[] = [];
	let creation: ReturnType<typeof deferred> | null = null;
	let retirement: ReturnType<typeof deferred> | null = null;
	let camera: MapCamera = { lat: 44.5, lon: 26.2, zoom: 14 };
	let bounds = { west: 26, east: 26.3, south: 44.3, north: 44.6 };
	let shellReady = true;
	let autoReady = true;
	let guarded = 0;
	const createRenderer = vi.fn<CoordinatorPorts['createRenderer']>(async (_container, _scene, events, context) => {
		const renderer: MapRenderer = {
			render: vi.fn(), setBasemap: vi.fn(), retryBasemap: vi.fn(), fitPoints: vi.fn(() => true),
			setCamera: vi.fn(value => { camera = value; return true; }), getCamera: () => camera, getBounds: () => bounds,
			setLanguage: vi.fn(), destroy: vi.fn(async () => {
				log.push(`destroy:${context.reader?.generation.id ?? 'online'}`);
				if (retirement) await retirement.promise;
				await context.reader?.close();
			})
		};
		engines.push({ renderer, events, context });
		if (creation) await creation.promise;
		if (autoReady) queueMicrotask(() => events.onBasemapStatus('ready'));
		return renderer;
	});
	const closeStorage = vi.fn();
	const coordinator = createOfflineMapCoordinator({ manager, estimate: async () => ({ usage: 4, quota: 1e9 }),
		shellReady: async () => shellReady, createRenderer, closeStorage,
		async runOperation(callback) { guarded++; try { return await callback(); } finally { guarded--; } } });
	const events: MapRendererEvents = { onStationSelect: vi.fn(), onBasemapStatus: vi.fn(), onRetryCooldown: vi.fn(), onCameraIdle: vi.fn(), onError: vi.fn() };
	return { coordinator, manager, readers, engines, log, events, createRenderer, closeStorage,
		setSnapshot(next: Partial<PackageSnapshot>) { snapshot = { ...snapshot, ...next }; },
		emit() { for (const listener of listeners) listener(); },
		blockCreation() { return creation = deferred(); }, blockRetirement() { return retirement = deferred(); },
		get guarded() { return guarded; }, manualReady() { autoReady = false; },
		setBounds(value: typeof bounds) { bounds = value; }, setShellReady(value: boolean) { shellReady = value; },
		async mount() { return await coordinator.rendererFactory({} as HTMLElement, scene(), events); }
	};
}

describe('offline application coordinator', () => {
	it('reopens the ready package on startup without requesting persistence or downloading', async () => {
		const h = environment(); await h.coordinator.start(); await h.mount();
		expect(h.coordinator.state.source).toBe('offline'); expect(h.coordinator.state.displayedGeneration).toBe('a');
		expect(h.manager.install).not.toHaveBeenCalled(); expect(h.manager.requestPersistence).not.toHaveBeenCalled();
		await h.coordinator.dispose();
	});
	it('keeps A displayed after B downloads, then explicitly switches with the same camera', async () => {
		const h = environment(); await h.coordinator.start(); const renderer = await h.mount();
		const camera = { lat: 44.7, lon: 26.3, zoom: 17 }; renderer.setCamera(camera, true);
		await h.coordinator.install(offer);
		expect(h.coordinator.state.snapshot?.active?.id).toBe('b'); expect(h.coordinator.state.displayedGeneration).toBe('a');
		expect(h.engines).toHaveLength(1);
		await h.coordinator.useOffline();
		expect(h.engines).toHaveLength(2); expect(h.engines[1].renderer.setCamera).toHaveBeenCalledWith(camera, true);
		expect(h.log.indexOf('destroy:a')).toBeLessThan(h.log.indexOf('close:a'));
		await h.coordinator.dispose();
	});
	it('keeps the latest scene and satellite selection through asynchronous source creation', async () => {
		const h = environment(); await h.coordinator.start(); const wrapper = await h.mount();
		const gate = h.blockCreation(); const switching = h.coordinator.useOnline();
		await vi.waitFor(() => expect(h.engines).toHaveLength(2));
		const next = { ...scene(), selectedStationId: 6084 }; wrapper.render(next); wrapper.setBasemap('satellite');
		gate.resolve(); await switching;
		expect(h.engines[1].renderer.render).toHaveBeenLastCalledWith(next);
		expect(h.engines[1].renderer.setBasemap).toHaveBeenLastCalledWith('satellite');
		expect(h.coordinator.state.usingOffline).toBe(false); await h.coordinator.dispose();
	});
	it('supersedes an in-flight offline open without leaking its lease or accepting stale events', async () => {
		const h = environment(null); await h.coordinator.start(); await h.mount(); await h.coordinator.install(offer);
		const gate = h.blockCreation(); const first = h.coordinator.useOffline();
		await vi.waitFor(() => expect(h.engines).toHaveLength(2));
		const next = h.coordinator.useOnline(); gate.resolve(); await Promise.all([first, next]);
		expect(h.readers[0].close).toHaveBeenCalled(); expect(h.coordinator.state.source).toBe('online');
		h.engines[1].events.onError?.({ kind: 'offline-data', message: 'late failure' });
		expect(h.coordinator.state.rendererError).toBeNull(); await h.coordinator.dispose();
	});
	it('closes an engine created after the coordinator was disposed', async () => {
		const h = environment(); await h.coordinator.start(); const gate = h.blockCreation(); const mounting = h.mount();
		await vi.waitFor(() => expect(h.engines).toHaveLength(1));
		const closing = h.coordinator.dispose(); gate.resolve(); const wrapper = await mounting; await closing; await wrapper.destroy();
		expect(h.engines[0].renderer.destroy).toHaveBeenCalledTimes(1); expect(h.readers[0].close).toHaveBeenCalledTimes(1);
		expect(h.closeStorage).toHaveBeenCalledOnce();
	});
	it('cancels deletion before waiting on the renderer, then releases its reader', async () => {
		const h = environment(); await h.coordinator.start(); await h.mount(); const gate = h.blockRetirement();
		const deleting = h.coordinator.remove();
		await vi.waitFor(() => expect(h.log).toContain('destroy:a'));
		expect(h.log.slice(0, 3)).toEqual(['cancel', 'remove', 'destroy:a']);
		gate.resolve(); await deleting; expect(h.coordinator.state.snapshot?.availability).toBe('absent');
		expect(h.readers[0].close).toHaveBeenCalled(); await h.coordinator.dispose();
	});
	it('releases a package deleted by another tab without selecting a newly downloaded version', async () => {
		const h = environment(); await h.coordinator.start(); await h.mount();
		h.setSnapshot({ active: null, availability: 'absent' }); await h.coordinator.refresh();
		await vi.waitFor(() => expect(h.coordinator.state.displayedGeneration).toBeNull());
		expect(h.coordinator.state.source).toBe('online'); expect(h.readers[0].close).toHaveBeenCalled(); await h.coordinator.dispose();
	});
	it('restores A after B fails its first frame', async () => {
		const h = environment(); await h.coordinator.start(); await h.mount(); await h.coordinator.install(offer); await h.coordinator.useOffline();
		expect(h.coordinator.state.displayedGeneration).toBe('b');
		await h.engines[1].context.callbacks.rejectRendered('b');
		await vi.waitFor(() => expect(h.coordinator.state.displayedGeneration).toBe('a'));
		expect(h.coordinator.state.snapshot?.pendingRender).toBe(false); expect(h.readers[1].close).toHaveBeenCalled(); await h.coordinator.dispose();
	});
	it('accepts an already confirmed exact generation but refuses a removed/replaced one', async () => {
		const h = environment(); await h.coordinator.start(); await h.mount();
		expect(await h.engines[0].context.callbacks.confirmRendered('a')).toBe(true);
		h.setSnapshot({ active: generation('b'), pendingRender: true });
		expect(await h.engines[0].context.callbacks.confirmRendered('a')).toBe(false); await h.coordinator.dispose();
	});
	it('confirms B only from its render callback', async () => {
		const h = environment(); await h.coordinator.start(); await h.mount(); await h.coordinator.install(offer); await h.coordinator.useOffline();
		expect(h.manager.confirmRendered).not.toHaveBeenCalled();
		expect(await h.engines[1].context.callbacks.confirmRendered('b')).toBe(true);
		expect(h.coordinator.state.snapshot?.pendingRender).toBe(false); await h.coordinator.dispose();
	});
	it('does not reopen B when language changes while A is still displayed', async () => {
		const h = environment(); await h.coordinator.start(); await h.mount(); await h.coordinator.install(offer);
		h.coordinator.setLanguage('en'); expect(h.engines).toHaveLength(1);
		expect(h.engines[0].renderer.setLanguage).toHaveBeenLastCalledWith('en'); expect(h.coordinator.state.displayedGeneration).toBe('a'); await h.coordinator.dispose();
	});
	it('distinguishes full, partial and absent coverage and excludes satellite', async () => {
		const h = environment(); await h.coordinator.start(); const wrapper = await h.mount();
		expect(h.coordinator.state.coverage).toBe('inside');
		h.setBounds({ west: 25.7, east: 26.3, south: 44.3, north: 44.6 }); h.engines[0].events.onCameraIdle(); expect(h.coordinator.state.coverage).toBe('partial');
		h.setBounds({ west: 26, east: 26.3, south: 44.81, north: 44.9 }); h.engines[0].events.onCameraIdle(); expect(h.coordinator.state.coverage).toBe('outside');
		wrapper.setBasemap('satellite'); expect(h.coordinator.state.usingOffline).toBe(false); expect(h.coordinator.state.coverage).toBe('unknown'); await h.coordinator.dispose();
	});
	it('does not open a reader when the current application shell is unavailable offline', async () => {
		const h = environment(); h.setShellReady(false); await h.coordinator.start(); await h.mount();
		await expect(h.coordinator.useOffline()).rejects.toThrow('shell-unavailable'); expect(h.manager.openActiveReader).not.toHaveBeenCalled(); await h.coordinator.dispose();
	});
	it('requests persistence only on explicit action and records actual resulting grant', async () => {
		const h = environment(); await h.coordinator.start(); expect(h.coordinator.state.snapshot?.persistence).toBe('not-granted');
		await h.coordinator.requestPersistence(); expect(h.coordinator.state.snapshot?.persistence).toBe('granted'); await h.coordinator.dispose();
	});
	it('holds the shell transition guard through the first ready frame and releases it on dispose', async () => {
		const h = environment(); await h.coordinator.start(); h.manualReady(); const mounting = h.mount();
		await vi.waitFor(() => expect(h.engines).toHaveLength(1));
		expect(h.guarded).toBe(1); h.engines[0].events.onBasemapStatus('ready'); await mounting; expect(h.guarded).toBe(0);
		const next = h.coordinator.reopen(); await vi.waitFor(() => expect(h.engines).toHaveLength(2));
		expect(h.guarded).toBe(1); await h.coordinator.dispose(); await next; expect(h.guarded).toBe(0);
	});
	it('cleans abandoned reader garbage on explicit refresh without notifying in a loop', async () => {
		const h = environment(); await h.coordinator.start(); await h.coordinator.refresh();
		expect(h.manager.cleanup).toHaveBeenCalledOnce(); h.emit();
		await vi.waitFor(() => expect(h.manager.snapshot).toHaveBeenCalledTimes(3));
		expect(h.manager.cleanup).toHaveBeenCalledOnce(); await h.coordinator.dispose();
	});
	it('keeps a newer package usable after an application rollback and refuses a downgrade offer', async () => {
		const h = environment(generation('b'));
		vi.mocked(h.manager.checkUpdate).mockResolvedValue({ manifest: generation('a').manifest, available: true });
		await h.coordinator.start(); await h.mount(); await h.coordinator.checkUpdate(offer);
		expect(h.coordinator.state.offer?.available).toBe(false);
		await expect(h.coordinator.install(offer)).rejects.toThrow('older-package');
		await expect(h.coordinator.install(offer, { repair: true })).rejects.toThrow('older-package');
		expect(h.manager.install).not.toHaveBeenCalled(); expect(h.coordinator.state.displayedGeneration).toBe('b'); await h.coordinator.dispose();
	});

	it('accepts an already proven A reader while a newly downloaded B waits for activation', async () => {
		const h = environment(); await h.coordinator.start(); await h.mount(); await h.coordinator.install(offer);
		expect(h.coordinator.state.snapshot?.previous?.id).toBe('a');
		expect(await h.engines[0].context.callbacks.confirmRendered('a')).toBe(true);
		expect(h.coordinator.state.snapshot?.active?.id).toBe('b'); expect(h.coordinator.state.snapshot?.pendingRender).toBe(true);
		h.setSnapshot({ active: null, previous: null, availability: 'absent' });
		expect(await h.engines[0].context.callbacks.confirmRendered('a')).toBe(false); await h.coordinator.dispose();
	});

	it('destroys a partially initialized renderer before releasing the package reader', async () => {
		const h = environment(); await h.coordinator.start(); const gate = h.blockCreation(); const mounting = h.mount();
		await vi.waitFor(() => expect(h.engines).toHaveLength(1));
		vi.mocked(h.engines[0].renderer.render).mockImplementation(() => { throw new Error('overlay failed'); });
		gate.resolve(); await mounting;
		expect(h.log).toEqual(['destroy:a', 'close:a']); expect(h.coordinator.state.rendererStatus).toBe('unavailable');
		await h.coordinator.dispose(); expect(h.engines[0].renderer.destroy).toHaveBeenCalledOnce();
	});

});
