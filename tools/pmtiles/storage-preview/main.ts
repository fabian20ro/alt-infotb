/// <reference types="vite/client" />
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { PMTiles, FileSource, Protocol } from 'pmtiles';
import { createOfflineMapManager } from '../../../src/lib/offline-maps/manager.ts';
import { createBrowserStorage } from '../../../src/lib/offline-maps/browser-storage.ts';
import { createPackageTransport } from '../../../src/lib/offline-maps/transport.ts';
import type { PackageOffer, PackageSnapshot, ReaderLease } from '../../../src/lib/offline-maps/contracts.ts';
import { createBrowserCandidateValidator } from '../src/browser-validation.ts';
import { readerFor, PLACES } from '../src/profile.ts';
import './style.css';

interface Config { publicRoot: string; regionId: string; offers: PackageOffer[]; versions: string[] }
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const state = { ready: false, mapReady: false, shellReady: false, errors: [] as string[], snapshot: null as PackageSnapshot | null };
const protocol = new Protocol();
const readers = new Map<string, ReaderLease>();
const held: ReaderLease[] = [];
let view: { map: maplibregl.Map; archive: PMTiles; lease: ReaderLease } | null = null;
maplibregl.setWorkerUrl(workerUrl);
maplibregl.addProtocol('pmtiles', protocol.tile);
maplibregl.addProtocol('localmap', async request => {
	const url = new URL(request.url);
	const reader = readers.get(url.hostname);
	if (!reader) throw new Error('Map reader has closed');
	const bytes = await (await reader.asset(decodeURIComponent(url.pathname.slice(1)))).arrayBuffer();
	return { data: request.type === 'json' ? JSON.parse(new TextDecoder().decode(bytes)) : bytes };
});
function describe() {
	element('details').textContent = JSON.stringify(state, null, 2);
	const progress = element<HTMLProgressElement>('progress');
	progress.hidden = !state.snapshot?.progress;
	if (state.snapshot?.progress) { progress.max = state.snapshot.progress.total; progress.value = state.snapshot.progress.bytes; }
	element('status').textContent = state.errors.at(-1) ?? (state.snapshot
		? `${state.snapshot.availability} · ${state.snapshot.operation} · stocare persistentă: ${state.snapshot.persistence}`
		: 'Se pregătește aplicația offline…');
}
function record(error: unknown) { state.errors.push(error instanceof Error ? error.message : String(error)); describe(); }
async function shellReady() {
	if (!navigator.serviceWorker.controller) return false;
	const descriptor = await (await fetch('/shell-assets.json')).json() as { cacheName: string; urls: string[] };
	const cache = await caches.open(descriptor.cacheName);
	return (await Promise.all(descriptor.urls.map(url => cache.match(url)))).every(Boolean);
}
async function main() {
	await navigator.serviceWorker.register('/sw.js');
	await navigator.serviceWorker.ready;
	if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
	state.shellReady = await shellReady();
	const config = await (await fetch('/config.json')).json() as Config;
	const managerConfig = { namespace: '/alt-infotb/pmtiles-storage-preview/', regionId: config.regionId, reader: readerFor(config.publicRoot) };
	const storage = await createBrowserStorage(managerConfig);
	// Test-only local distributor. Real transport retains HTTPS/origin/hash policy.
	const localFetch: typeof fetch = async (input, init) => {
		const logical = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
		const base = new URL(config.publicRoot);
		if (logical.origin !== base.origin || !logical.pathname.startsWith(base.pathname) || logical.search || logical.hash) throw new Error('Unknown test distribution URL');
		const relative = logical.pathname.slice(base.pathname.length);
		if (!relative.startsWith(`${config.regionId}/`)) throw new Error('Unknown test region');
		const response = await fetch(`/package/${relative.slice(config.regionId.length + 1)}`, init);
		return new Response(response.body, { status: response.status, headers: response.headers });
	};
	const manager = createOfflineMapManager(managerConfig, { ...storage,
		transport: createPackageTransport({ fetch: localFetch }), validate: createBrowserCandidateValidator(storage.files),
		shellReady, newId: () => crypto.randomUUID() });
	async function refresh() { state.snapshot = await manager.snapshot(); describe(); return state.snapshot; }
	async function closeView() {
		const old = view; view = null; state.mapReady = false;
		if (old) { old.map.remove(); protocol.tiles.delete(old.archive.source.getKey()); readers.delete(old.lease.generation.id); await old.lease.close(); }
	}
	async function openView(confirm = true) {
		await closeView();
		const lease = await manager.openActiveReader();
		readers.set(lease.generation.id, lease);
		try {
			const archive = new PMTiles(new FileSource(new File([await lease.archive()], `${lease.generation.id}.pmtiles`)));
			protocol.add(archive);
			const theme = element<HTMLSelectElement>('theme').value;
			const style = JSON.parse(await (await lease.asset(`${theme}.json`)).text()) as maplibregl.StyleSpecification;
			style.glyphs = `localmap://${lease.generation.id}/fonts/{fontstack}/{range}.pbf`;
			style.sprite = `localmap://${lease.generation.id}/sprites/${theme}`;
			style.sources = { basemap: { type: 'vector', url: `pmtiles://${archive.source.getKey()}`,
				attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Protomaps · Natural Earth' } };
			const map = new maplibregl.Map({ container: 'map', style, center: PLACES.Bucuresti, zoom: 12,
				localIdeographFontFamily: 'sans-serif', attributionControl: { compact: true }, fadeDuration: 0 });
			view = { map, archive, lease };
			map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Map rendering timeout')), 30_000);
				map.once('idle', () => { clearTimeout(timeout); resolve(); });
				map.on('error', event => { clearTimeout(timeout); reject(event.error); });
				map.on('styleimagemissing', event => { clearTimeout(timeout); reject(new Error(`Missing sprite: ${event.id}`)); });
			});
			if (confirm) await manager.confirmRendered(lease.generation.id);
			state.mapReady = true; await refresh();
			return { features: map.queryRenderedFeatures().length, symbols: map.queryRenderedFeatures().filter(f => f.layer.type === 'symbol').length };
		} catch (error) {
			await closeView(); readers.delete(lease.generation.id); await lease.close();
			await manager.rejectRendered(lease.generation.id); await refresh(); throw error;
		}
	}
	async function install(index = 0, repair = false) {
		state.errors = []; await manager.install(config.offers[index], undefined, { repair }); await openView();
	}
	async function remove() { await closeView(); await manager.remove(); await refresh(); }
	function action(id: string, callback: () => Promise<unknown>) { element(id).onclick = () => { void callback().catch(record); }; }
	action('install', () => install());
	action('update', async () => {
		const result = await manager.checkUpdate(config.offers[1]);
		if (result.available) await install(1);
	});
	action('persist', async () => { await manager.requestPersistence(); await refresh(); });
	action('remove', remove); action('reopen', openView); action('cancel', () => manager.cancel());
	element('theme').onchange = () => { void openView().catch(record); };
	let refreshPending = false;
	manager.subscribe(() => { if (!refreshPending) { refreshPending = true; setTimeout(() => { refreshPending = false; void refresh().catch(record); }, 40); } });
	Object.assign(window, { storageHarness: { state, manager, storage, offers: config.offers, install, remove, refresh, openView, closeView,
		async holdReader() { const lease = await manager.openActiveReader(); held.push(lease); return lease.generation.id; },
		async releaseReaders() { for (const lease of held.splice(0)) await lease.close(); await refresh(); },
		async sample() { if (!view) throw new Error('No map'); const fs = view.map.queryRenderedFeatures(); return { features: fs.length, symbols: fs.filter(f => f.layer.type === 'symbol').length }; }
	} });
	await manager.recover(); await refresh();
	if (state.snapshot?.availability === 'ready') await openView();
	state.ready = true; describe();
}
void main().catch(record);
