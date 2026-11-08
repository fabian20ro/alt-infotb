import type { MapCamera, MapRenderer, MapRendererEvents, MapRendererFactory, BasemapStatus, MapRendererError } from '../map/renderer.js';
import type { Basemap, MapScene } from '../map/model.js';
import type { OfflineRenderCallbacks } from '../map/pmtiles-source.js';
import type { Generation, PackageOffer, PackageSnapshot, ReaderLease } from './contracts.js';
import type { OfflineMapManifest } from './manifest.js';
import type { createOfflineMapManager } from './manager.js';

type Manager = ReturnType<typeof createOfflineMapManager>;
type Estimate = { usage?: number; quota?: number };
export type Coverage = 'inside' | 'partial' | 'outside' | 'unknown';
export interface CoordinatorState {
	status: 'starting' | 'ready' | 'unsupported';
	snapshot: PackageSnapshot | null;
	offer: { manifest: OfflineMapManifest; available: boolean } | null;
	estimate: Estimate;
	shellReady: boolean;
	busy: boolean;
	error: string | null;
	source: 'online' | 'offline';
	usingOffline: boolean;
	displayedGeneration: string | null;
	rendererStatus: BasemapStatus;
	rendererError: MapRendererError['kind'] | null;
	coverage: Coverage;
}
export interface CoordinatorPorts {
	manager: Manager;
	estimate(): Promise<Estimate>;
	shellReady(): Promise<boolean>;
	/** Shared shell-transition lock; new-worker activation takes the exclusive counterpart. */
	runOperation?<T>(action: () => Promise<T>): Promise<T>;
	createRenderer(container: HTMLElement, scene: MapScene, events: MapRendererEvents, options: {
		reader: ReaderLease | null; callbacks: OfflineRenderCallbacks; lang: 'ro' | 'en';
	}): MapRenderer | Promise<MapRenderer>;
	closeStorage?(): void;
}
interface Attachment {
	container: HTMLElement; events: MapRendererEvents; scene: MapScene; basemap: Basemap;
	renderer: MapRenderer | null; generation: Generation | null; closed: boolean;
	revision: number; queue: Promise<void>; camera: MapCamera | null; cancelFrame?: () => void;
}
function compareRelease(next: OfflineMapManifest, current: OfflineMapManifest): number {
	if (next.dataDate !== current.dataDate) return next.dataDate < current.dataDate ? -1 : 1;
	if (next.version === current.version) return 0;
	const parse = (version: string) => /^(\d{8})-v([1-9]\d*)$/.exec(version);
	const a = parse(next.version), b = parse(current.version);
	if (!a || !b || a[1] !== next.dataDate.replaceAll('-', '') || b[1] !== current.dataDate.replaceAll('-', '')) return -1;
	return BigInt(a[2]) < BigInt(b[2]) ? -1 : 1;
}
const message = (error: unknown): string => error instanceof Error
	? ('code' in error && typeof error.code === 'string' ? error.code : error.name === 'QuotaExceededError' ? 'quota' : error.name === 'AbortError' ? 'cancelled' : error.message)
	: String(error);

/** Application policy only. The manager owns durable state; renderers only receive leased bytes. */
export function createOfflineMapCoordinator(ports: CoordinatorPorts) {
	let state: CoordinatorState = { status: 'starting', snapshot: null, offer: null, estimate: {}, shellReady: false,
		busy: false, error: null, source: 'online', usingOffline: false, displayedGeneration: null,
		rendererStatus: 'loading', rendererError: null, coverage: 'unknown' };
	const listeners = new Set<() => void>();
	let attachment: Attachment | null = null;
	let disposed = false;
	let language: 'ro' | 'en' = 'ro';
	let operations = 0;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	let refreshPromise: Promise<void> | null = null;
	let refreshAgain = false;
	const run = <T>(action: () => Promise<T>) => ports.runOperation ? ports.runOperation(action) : action();
	function patch(next: Partial<CoordinatorState>) {
		if (disposed) return;
		state = { ...state, ...next };
		for (const listener of listeners) { try { listener(); } catch { /* Observers cannot undo operations. */ } }
	}
	function alive() { if (disposed) throw new Error('Offline coordinator disposed'); }
	async function action<T>(callback: () => Promise<T>): Promise<T> {
		alive(); operations++; patch({ busy: true, error: null });
		try { return await callback(); }
		catch (error) { patch({ error: message(error) === 'cancelled' ? null : message(error) }); throw error; }
		finally { operations--; patch({ busy: operations > 0 }); }
	}
	function coverage() {
		const view = attachment;
		const usingOffline = state.source === 'offline' && !!view?.generation && view.basemap !== 'satellite';
		let result: Coverage = 'unknown';
		const bounds = view?.renderer?.getBounds?.();
		if (usingOffline && bounds && view?.generation) {
			const [west, south, east, north] = view.generation.manifest.bounds;
			result = bounds.east < west || bounds.west > east || bounds.north < south || bounds.south > north ? 'outside'
				: bounds.west >= west && bounds.east <= east && bounds.south >= south && bounds.north <= north ? 'inside' : 'partial';
		}
		patch({ usingOffline, coverage: result });
	}
	async function refresh(): Promise<void> {
		alive();
		if (refreshPromise) { refreshAgain = true; return refreshPromise; }
		refreshPromise = (async () => {
			do {
				refreshAgain = false;
				const [snapshot, estimate, shellReady] = await Promise.all([ports.manager.snapshot(), ports.estimate(), ports.shellReady()]);
				if (disposed) return;
				patch({ snapshot, estimate, shellReady, offer: state.offer ? { ...state.offer,
					available: !snapshot.active || compareRelease(state.offer.manifest, snapshot.active.manifest) > 0 } : null });
				// A delete in another tab must release this tab's lease too. Do not automatically
				// adopt a newly downloaded generation: the current map stays until Use offline.
				if (state.source === 'offline' && !snapshot.active) void switchSource('online').catch(error => patch({ error: message(error) }));
			} while (refreshAgain && !disposed);
		})().finally(() => { refreshPromise = null; });
		return refreshPromise;
	}
	function scheduleRefresh() {
		if (disposed || refreshTimer) return;
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined;
			void refresh().catch(error => patch({ error: message(error) }));
		}, 100);
	}
	const unsubscribe = ports.manager.subscribe(scheduleRefresh);
	function valid(view: Attachment, revision: number) { return !disposed && !view.closed && attachment === view && view.revision === revision; }
	async function replace(view: Attachment, revision: number) {
		if (!valid(view, revision)) return;
		let finishFrame!: () => void;
		const firstFrame = new Promise<void>(resolve => { finishFrame = resolve; });
		view.cancelFrame = finishFrame;
		const frameTimeout = setTimeout(() => {
			if (valid(view, revision)) patch({ rendererStatus: 'unavailable', error: 'render-timeout' });
			finishFrame();
		}, 35_000);
		const old = view.renderer;
		let reader: ReaderLease | null = null;
		let previouslyConfirmed = false;
		let created: MapRenderer | null = null;
		try {
			if (state.source === 'offline') {
				if (!await ports.shellReady()) throw new Error('shell-unavailable');
				const before = await ports.manager.snapshot();
				reader = await ports.manager.openActiveReader();
				previouslyConfirmed = before.active?.id === reader.generation.id && before.availability === 'ready' && !before.pendingRender;
			}
			if (!valid(view, revision)) { await reader?.close(); return; }
			view.camera = old?.getCamera?.() ?? view.camera;
			view.renderer = null; view.generation = null;
			patch({ rendererStatus: 'loading', rendererError: null, displayedGeneration: null, usingOffline: false });
			await old?.destroy();
			if (!valid(view, revision)) { await reader?.close(); return; }
			const generation = reader?.generation ?? null;
			const callbacks: OfflineRenderCallbacks = {
				async confirmRendered(id) {
					if (!valid(view, revision)) return false;
					const confirmed = await ports.manager.confirmRendered(id);
					await refresh();
					return confirmed || (state.snapshot?.active?.id === id && state.snapshot.availability === 'ready' && !state.snapshot.pendingRender)
						|| (previouslyConfirmed && state.snapshot?.previous?.id === id);
				},
				async rejectRendered(id) {
					const rejected = await ports.manager.rejectRendered(id);
					await refresh();
					if (valid(view, revision) && state.source === 'offline' && state.snapshot?.availability === 'ready'
						&& state.snapshot.active?.id !== id) {
						// The manager restored A after B's failed first frame. Reopen its exact active lease.
						void switchSource('offline').catch(error => patch({ error: message(error) }));
					}
					return rejected;
				}
			};
			const events: MapRendererEvents = {
				onStationSelect(station) { if (valid(view, revision)) view.events.onStationSelect(station); },
				onBasemapStatus(status) { if (valid(view, revision)) { patch({ rendererStatus: status }); view.events.onBasemapStatus(status); if (status !== 'loading') finishFrame(); } },
				onRetryCooldown(active) { if (valid(view, revision)) view.events.onRetryCooldown(active); },
				onCameraIdle() { if (valid(view, revision)) { coverage(); view.events.onCameraIdle(); } },
				onError(error) { if (valid(view, revision)) { patch({ rendererError: error.kind }); view.events.onError?.(error); } }
			};
			created = await ports.createRenderer(view.container, view.scene, events, { reader, callbacks, lang: language });
			// From here the renderer owns the reader, including constructor cleanup on failure.
			if (!valid(view, revision)) { await created.destroy(); return; }
			view.renderer = created; view.generation = generation;
			created.render(view.scene);
			created.setBasemap(view.basemap);
			created.setLanguage?.(language);
			if (view.camera) created.setCamera(view.camera, true);
			patch({ displayedGeneration: generation?.id ?? null }); coverage();
			view.events.onCameraIdle();
			// The shared shell-transition lock remains held until the first rendered frame
			// (including package confirmation), a terminal raster state, or cancellation.
			await firstFrame;
		} catch (error) {
			// A partially initialized renderer must release its map before its leased bytes.
			if (created) {
				if (view.renderer === created) { view.renderer = null; view.generation = null; }
				await created.destroy();
			} else await reader?.close();
			// A failed factory may already have closed its source; lease.close is idempotent.
			if (valid(view, revision)) { patch({ rendererStatus: 'unavailable', error: message(error) }); view.events.onBasemapStatus('unavailable'); }
			throw error;
		} finally { clearTimeout(frameTimeout); if (view.cancelFrame === finishFrame) view.cancelFrame = undefined; }
	}
	function queueSwap(view: Attachment) {
		view.cancelFrame?.();
		const revision = ++view.revision;
		const operation = view.queue.catch(() => {}).then(() => run(() => replace(view, revision)));
		view.queue = operation;
		return operation;
	}
	async function switchSource(source: 'online' | 'offline') {
		alive(); patch({ source, rendererError: null });
		if (attachment) await queueSwap(attachment);
		else coverage();
	}
	const rendererFactory: MapRendererFactory = async (container, scene, events) => {
		alive();
		if (attachment && !attachment.closed) throw new Error('Offline coordinator already has a map');
		const view: Attachment = { container, scene, events, basemap: scene.theme, renderer: null, generation: null,
			closed: false, revision: 0, queue: Promise.resolve(), camera: null };
		attachment = view;
		// Factory failures remain actionable in the panel; return a live wrapper so Retry can recover.
		await queueSwap(view).catch(() => {});
		return {
			render(next) { view.scene = next; view.renderer?.render(next); },
			setBasemap(basemap) { view.basemap = basemap; view.renderer?.setBasemap(basemap); coverage(); },
			retryBasemap() { if (state.rendererError === 'context-lost' || state.rendererError === 'offline-data' || !view.renderer) void action(() => switchSource(state.source)).catch(() => {}); else view.renderer.retryBasemap(); },
			setCamera(camera, immediate) { return view.renderer?.setCamera(camera, immediate) ?? false; },
			fitPoints(points, purpose) { return view.renderer?.fitPoints(points, purpose) ?? false; },
			getCamera() { return view.renderer?.getCamera?.() ?? view.camera ?? { lat: 44.4268, lon: 26.1025, zoom: 15 }; },
			getBounds() { return view.renderer?.getBounds?.() ?? { south: 0, north: 0, west: 0, east: 0 }; },
			setLanguage(lang) { language = lang; view.renderer?.setLanguage?.(lang); },
			async destroy() {
				if (view.closed) return view.queue.catch(() => {});
				view.closed = true; ++view.revision; view.cancelFrame?.();
				await view.queue.catch(() => {});
				const old = view.renderer; view.renderer = null; await old?.destroy();
				if (attachment === view) attachment = null;
			}
		};
	};
	return {
		get state() { return state; }, rendererFactory,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		async start() {
			await action(async () => {
				await run(() => ports.manager.recover()); await refresh();
				patch({ status: 'ready' });
				if (state.snapshot?.availability === 'ready' && state.shellReady) await switchSource('offline');
			});
		},
		async refresh() { await run(() => ports.manager.cleanup()); await refresh(); },
		checkUpdate(offer: PackageOffer) { return action(async () => {
			const result = await ports.manager.checkUpdate(offer); await refresh();
			const current = state.snapshot?.active;
			patch({ offer: { ...result, available: result.available && (!current || compareRelease(result.manifest, current.manifest) > 0) } });
		}); },
		install(offer: PackageOffer, options: { repair?: boolean } = {}) { return action(async () => {
			await run(async () => {
				const next = await ports.manager.checkUpdate(offer);
				const current = (await ports.manager.snapshot()).active;
				if (current && compareRelease(next.manifest, current.manifest) < 0) throw new Error('older-package');
				await ports.manager.install(offer, undefined, options);
			}); await refresh();
			if (state.offer) patch({ offer: { ...state.offer, available: state.snapshot?.active?.manifestSha256 !== offer.manifestSha256 } });
		}); },
		useOffline() { return action(() => switchSource('offline')); },
		useOnline() { return action(() => switchSource('online')); },
		reopen() { return action(() => switchSource(state.source)); },
		remove() { return action(async () => {
			// Start cancellation before waiting on renderer cleanup or shell transition locks.
			await ports.manager.cancel();
			await run(() => ports.manager.remove());
			await switchSource('online'); await refresh();
		}); },
		cancel() { return action(async () => { await ports.manager.cancel(); await refresh(); }); },
		requestPersistence() { return action(async () => { await ports.manager.requestPersistence(); await refresh(); }); },
		setLanguage(lang: 'ro' | 'en') { language = lang; attachment?.renderer?.setLanguage?.(lang); },
		async dispose() {
			if (disposed) return;
			disposed = true; unsubscribe(); listeners.clear(); if (refreshTimer) clearTimeout(refreshTimer);
			// Abort installs first: closing a reader may queue cleanup behind their mutation lock.
			const managerClosing = ports.manager.dispose();
			const view = attachment; attachment = null;
			if (view) { view.closed = true; ++view.revision; view.cancelFrame?.(); await view.queue.catch(() => {}); await view.renderer?.destroy(); }
			await managerClosing; await refreshPromise?.catch(() => {}); ports.closeStorage?.();
		}
	};
}
export type OfflineMapCoordinator = ReturnType<typeof createOfflineMapCoordinator>;
