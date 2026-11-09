import { createBrowserStorage } from './browser-storage.js';
import { createOfflineMapManager } from './manager.js';
import { createPackageTransport } from './transport.js';
import { createBrowserCandidateValidator } from './browser-validation.js';
import { createOfflineMapCoordinator } from './coordinator.js';
import { PMTILES_PROFILE } from './profile.js';
import { createMapLibreRenderer } from '../map/maplibre-renderer.js';
import { createPmtilesSource } from '../map/pmtiles-source.js';
import type { PackageOffer } from './contracts.js';

/** Build-time operator configuration, never learned from an unauthenticated remote manifest. */
export interface OfflinePreviewConfig { namespace: string; regionId: string; publicRoot: string; offers: PackageOffer[] }
export interface OfflineRuntimeOptions {
	shellReady(): Promise<boolean>;
	runOperation?<T>(action: () => Promise<T>): Promise<T>;
	/** The local preview distributor only. Production transport keeps its HTTPS policy. */
	fetch?: typeof fetch;
}

export function createLocalPackageFetch(config: OfflinePreviewConfig): typeof fetch {
	if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Local package distribution requires localhost');
	const root = new URL(config.publicRoot);
	if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash || !root.pathname.endsWith('/')) throw new Error('Invalid trusted package root');
	const versions = new Set(config.offers.map(offer => {
		const manifest = new URL(offer.manifestUrl);
		if (manifest.origin !== root.origin || !manifest.pathname.startsWith(`${root.pathname}${config.regionId}/`) || !manifest.pathname.endsWith('/manifest.json')) throw new Error('Foreign preview offer');
		return manifest.pathname.slice(`${root.pathname}${config.regionId}/`.length).split('/')[0];
	}));
	return async (input, init) => {
		const logical = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
		const prefix = `${root.pathname}${config.regionId}/`;
		if (logical.origin !== root.origin || !logical.pathname.startsWith(prefix) || logical.search || logical.hash || logical.username || logical.password) throw new Error('Unknown preview package URL');
		const relative = logical.pathname.slice(prefix.length);
		if (!versions.has(relative.split('/')[0]) || /%2f|%5c|%2e/i.test(relative)) throw new Error('Unknown preview package version/path');
		const response = await fetch(`${config.namespace}__offline_downloads__/${relative}`, init);
		// The logical HTTPS URL has already been validated; the loopback URL is transport-only.
		return new Response(response.body, { status: response.status, headers: response.headers });
	};
}

export async function createOfflineMapRuntime(config: OfflinePreviewConfig, options: OfflineRuntimeOptions) {
	const publicRoot = new URL(config.publicRoot);
	if (publicRoot.protocol !== 'https:' || publicRoot.username || publicRoot.password || publicRoot.search || publicRoot.hash) throw new Error('Invalid package origin');
	const managerConfig = { namespace: config.namespace, regionId: config.regionId,
		reader: { version: 1, allowedOrigins: [publicRoot.origin], profiles: [PMTILES_PROFILE] } };
	const transportFetch = options.fetch ?? createLocalPackageFetch(config);
	const storage = await createBrowserStorage(managerConfig);
	const manager = createOfflineMapManager(managerConfig, { ...storage,
		transport: createPackageTransport({ fetch: transportFetch }),
		validate: createBrowserCandidateValidator(storage.files), shellReady: options.shellReady, newId: () => crypto.randomUUID() });
	const coordinator = createOfflineMapCoordinator({ manager, estimate: storage.storage.estimate, shellReady: options.shellReady,
		runOperation: options.runOperation, closeStorage: storage.close,
		async createRenderer(container, scene, events, context) {
			const offline = context.reader ? createPmtilesSource(context.reader, context.callbacks) : undefined;
			try { return createMapLibreRenderer(container, scene, events, { offline, lang: context.lang }); }
			catch (error) {
				if (offline) throw error;
				// Browsers without WebGL still retain the existing online map. The panel
				// reports the renderer limitation and never calls raster a regional offline map.
				events.onError?.({ kind: 'context-lost', message: error instanceof Error ? error.message : String(error) });
				const { createLeafletRenderer } = await import('../map/leaflet-renderer.js');
				return createLeafletRenderer(container, scene, events);
			}
		} });
	try { await coordinator.start(); return coordinator; }
	catch (error) { await coordinator.dispose(); throw error; }
}
