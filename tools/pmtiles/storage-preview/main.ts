/// <reference types="vite/client" />
import { createOfflineMapManager } from '../../../src/lib/offline-maps/manager.ts';
import { createBrowserStorage } from '../../../src/lib/offline-maps/browser-storage.ts';
import { createPackageTransport } from '../../../src/lib/offline-maps/transport.ts';
import type { PackageOffer, PackageSnapshot, ReaderLease } from '../../../src/lib/offline-maps/contracts.ts';
import { createMapLibreRenderer, type MapLibreRenderer } from '../../../src/lib/map/maplibre-renderer.ts';
import { createPmtilesSource } from '../../../src/lib/map/pmtiles-source.ts';
import { createMapController } from '../../../src/lib/map/controller.ts';
import { createMapScene, type MapRouteOverlay, type MapTheme } from '../../../src/lib/map/model.ts';
import { loadStations } from '../../../src/lib/stations/data.ts';
import captured from '../../../e2e/fixtures/line66-scene.json';
import { createBrowserCandidateValidator } from '../src/browser-validation.ts';
import { readerFor, PLACES } from '../src/profile.ts';
import './style.css';

interface Config { publicRoot: string; regionId: string; offers: PackageOffer[]; versions: string[] }
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const state = { ready: false, mapReady: false, shellReady: false, errors: [] as string[], snapshot: null as PackageSnapshot | null, selectedStation: null as number|null, line: '66', basemapStatus: 'loading', lastErrorKind: '' };
const held: ReaderLease[] = [];
const stations=loadStations();
let route: MapRouteOverlay|null=structuredClone(captured);
let view: { renderer: MapLibreRenderer; controller: ReturnType<typeof createMapController> } | null = null;
let overview=0;
function scene() {return createMapScene({allStations:stations,selectedStationId:state.selectedStation,userPosition:{lat:44.4268,lon:26.1025,accuracy:20},locationPermission:'granted',locationError:null,theme:element<HTMLSelectElement>('theme').value as MapTheme,route});}
function describe() {
	element('details').textContent = JSON.stringify(state, null, 2);
	const progress = element<HTMLProgressElement>('progress');
	progress.hidden = !state.snapshot?.progress;
	if (state.snapshot?.progress) { progress.max = state.snapshot.progress.total; progress.value = state.snapshot.progress.bytes; }
	element('status').textContent = state.errors.at(-1) ?? (state.snapshot
		? `${state.snapshot.availability} · ${state.snapshot.operation} · stocare persistentă: ${state.snapshot.persistence}`
		: 'Se pregătește aplicația offline…');
	element('map').classList.toggle('route-mode',!!route);
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
	// Inspect reads every asset: serialize scans and revisit the latest journal
	// when notifications arrive during an unfinished inspection.
	let refreshTask: Promise<PackageSnapshot> | null = null;
	let refreshAgain = false;
	async function refresh(): Promise<PackageSnapshot> {
		if (refreshTask) { refreshAgain = true; return refreshTask; }
		refreshTask = (async () => {
			do {
				refreshAgain = false;
				state.snapshot = await manager.snapshot();
				describe();
			} while (refreshAgain);
			return state.snapshot!;
		})().finally(() => { refreshTask = null; });
		return refreshTask;
	}
	async function closeView() {
		const old = view; view = null; state.mapReady = false;
		if (old) await old.renderer.destroy();
	}
	async function openView(confirm = true) {
		await closeView();
		const before=await manager.snapshot();
		const lease = await manager.openActiveReader();
		const previouslyConfirmed=before.active?.id===lease.generation.id&&!before.pendingRender&&before.availability==='ready';
		const source=createPmtilesSource(lease,{
			async confirmRendered(id) {
				if(!confirm||previouslyConfirmed)return true;
				if(await manager.confirmRendered(id))return true;
				const latest=await manager.snapshot();return latest.active?.id===id&&!latest.pendingRender&&latest.availability==='ready';
			},rejectRendered:id=>manager.rejectRendered(id)
		});
		let resolve!:()=>void,reject!:(error:unknown)=>void;
		const rendered=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
		const timeout=setTimeout(()=>reject(new Error('Map rendering timeout')),45_000);
		try {
			const renderer=createMapLibreRenderer(element('map'),scene(),{
				onStationSelect(station){state.selectedStation=station.id;view?.controller.update(scene());describe();},
				onBasemapStatus(status){state.basemapStatus=status;state.mapReady=status==='ready';if(status==='ready')resolve();else if(status==='unavailable')reject(new Error('Offline basemap unavailable'));},
				onRetryCooldown(){},onCameraIdle(){view?.controller.cameraIdle();},
				onError(error){state.lastErrorKind=error.kind;record(new Error(`${error.kind}: ${error.message}`));reject(new Error(error.message));}
			},{offline:source,lang:'ro'});
			const controller=createMapController(renderer,()=>{});view={renderer,controller};
			controller.update(scene());renderer.setCamera({lat:PLACES.Bucuresti[1],lon:PLACES.Bucuresti[0],zoom:13},true);
			renderer.setBasemap(scene().theme);
			await rendered;state.mapReady=true;await refresh();return renderer.inspect();
		} catch(error) {await closeView();await source.close();await manager.rejectRendered(lease.generation.id);await refresh();throw error;}
		finally{clearTimeout(timeout);}
	}
	async function install(index = 0, repair = false) {
		state.errors = []; await manager.install(config.offers[index], undefined, { repair }); await openView();
	}
	async function remove() { await manager.remove(); await closeView(); await refresh(); }
	async function selectLine(line:string){
		state.line=line;state.selectedStation=null;
		route=line==='66'?structuredClone(captured):line==='N109'?{key:'N109',lineId:199,lineName:'N109',vehicleType:'BUS',primary:null,opposite:null}:line==='446'?{key:'446',lineId:859,lineName:'446',vehicleType:'BUS',primary:null,opposite:null}:null;
		view?.controller.update(scene());
		const current=scene();const served=stations.filter(s=>current.routeStationIds.has(s.id));
		if(served.length)view?.renderer.fitPoints(served,'overview');describe();
	}
	function action(id: string, callback: () => Promise<unknown>|void) { element(id).onclick = () => { void Promise.resolve().then(callback).catch(record); }; }
	action('install', () => install());
	action('update', async () => { if ((await manager.checkUpdate(config.offers[1])).available) await install(1); });
	action('persist', async () => { await manager.requestPersistence(); await refresh(); });
	action('remove', remove); action('reopen', openView); action('cancel', () => manager.cancel());
	action('recenter',()=>view?.controller.recenter());
	action('overview',()=>{if(route)view?.controller.overview({id:++overview,routeKey:route.key});});
	element('line').onchange=()=>{void selectLine(element<HTMLSelectElement>('line').value);};
	element('theme').onchange = () => {view?.controller.update(scene());view?.renderer.setBasemap(scene().theme);};
	let refreshPending = false;
	manager.subscribe(() => { if (refreshTask) { refreshAgain = true; return; } if (!refreshPending) { refreshPending = true; setTimeout(() => { refreshPending = false; void refresh().catch(record); }, 40); } });
	Object.assign(window, { storageHarness: { state, manager, storage, offers: config.offers, install, remove, refresh, openView, closeView,selectLine,
		async holdReader() { const lease = await manager.openActiveReader(); held.push(lease); return lease.generation.id; },
		async releaseReaders() { for (const lease of held.splice(0)) await lease.close(); await refresh(); },
		async sample() { if (!view) throw new Error('No map'); return view.renderer.inspect(); },
		camera(lat:number,lon:number,zoom:number){view?.renderer.setCamera({lat,lon,zoom},true);},
		async switchBasemap(theme:'light'|'dark'|'satellite'){view?.renderer.setBasemap(theme);},
		async repairView(){await closeView();await openView();}
	} });
	await manager.recover(); await refresh();
	if (state.snapshot?.availability === 'ready') await openView();
	state.ready = true; describe();
}
void main().catch(record);
