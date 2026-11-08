<script lang="ts">
	import { tick } from 'svelte';
	import MapView from '../../src/lib/components/MapView.svelte';
	import { createMapScene, type MapRouteOverlay, type RouteOverviewRequest } from '../../src/lib/map/model.js';
	import type { MapRenderer, MapRendererFactory } from '../../src/lib/map/renderer.js';
	import { loadStations } from '../../src/lib/stations/data.js';
	import type { Station } from '../../src/lib/stations/types.js';
	import captured from './line66-scene.json';
	const engine = new URLSearchParams(location.search).get('engine') ?? 'leaflet';
	const small: Station[] = [
		{ id: 1, name: 'Stația A', description: '', lat: 44.4268, lon: 26.1025, lineIds: [72] },
		{ id: 2, name: 'Stația B', description: '', lat: 44.4281, lon: 26.1025, lineIds: [72] },
		{ id: 3, name: 'Sens întors', description: '', lat: 44.4253, lon: 26.1025, lineIds: [72] },
		{ id: 4, name: 'Altă linie', description: '', lat: 44.4268, lon: 26.1042, lineIds: [57] }
	];
	let catalog = $state(small);
	let selected = $state<number | null>(null);
	let selections = $state<number[]>([]);
	let theme = $state<'light'|'dark'>('dark');
	let lang = $state<'ro'|'en'>('ro');
	let position = $state<{lat:number;lon:number;accuracy:number}|null>(location.search.includes('no-position') ? null : {lat:44.4268,lon:26.1025,accuracy:20});
	let permission = $state<'granted'|'denied'>('granted');
	let locationError = $state<string|null>(null);
	let route = $state<MapRouteOverlay|null>(null);
	let overview = $state<RouteOverviewRequest|null>(null);
	let mounted = $state(true);
	let actual: MapRenderer|null = null;
	const stats = { engine, camera:0, fits:0, destroys:0, errors:[] as string[], ready:false };
	let releaseFactory: (()=>void)|null=null;
	const factory: MapRendererFactory = async (container,scene,events) => {
		if(location.search.includes('factory-fail'))throw new Error('Explicit preview factory failure');
		const create = engine === 'maplibre' ? (await import('../../src/lib/map/maplibre-renderer.js')).createMapLibreRenderer
			: (await import('../../src/lib/map/leaflet-renderer.js')).createLeafletRenderer;
		actual = await create(container,scene,events);
		const renderer = actual;
		stats.ready = true;
		if(location.search.includes('factory-slow'))await new Promise<void>(resolve=>{releaseFactory=resolve;});
		return {...renderer,
			setCamera(...args) { stats.camera++; return renderer.setCamera(...args); },
			fitPoints(...args) { const accepted=renderer.fitPoints(...args); if(accepted)stats.fits++; return accepted; },
			destroy() { stats.destroys++; stats.ready=false; return renderer.destroy(); }
		};
	};
	async function showReal(line: '66'|'N109') {
		catalog = loadStations();
		selected = null;
		route = line === '66' ? structuredClone(captured) : {key:'n109',lineId:199,lineName:'N109',vehicleType:'BUS',primary:null,opposite:null};
		if (line === '66' && route.primary && route.opposite) {
			// Recorded capture contains no vehicles; these two positions are explicit synthetic fixtures.
			route.primary.vehicles=[{id:10001,...route.primary.path[30],vehicleType:'CABLE_CAR',accessible:true}];
			route.opposite.vehicles=[{id:10002,...route.opposite.path[40],vehicleType:'CABLE_CAR',accessible:false}];
		}
		await tick();
		const scene=createMapScene({allStations:catalog,selectedStationId:selected,userPosition:position,locationPermission:permission,locationError,theme,route});
		actual?.fitPoints(catalog.filter(s=>scene.routeStationIds.has(s.id)), 'overview');
	}
	Object.assign(window,{parity:{stats,captured,inspect:()=>actual && 'inspect' in actual ? (actual as any).inspect() : null,
		releaseFactory:()=>releaseFactory?.(),
		burst:()=>{if(!actual)return;for(let i=0;i<3;i++){const next=structuredClone(captured) as MapRouteOverlay;next.primary!.lineName=i===2?'FINAL':'STALE';next.primary!.vehicles=[{id:900+i,...next.primary!.path[30],vehicleType:'CABLE_CAR',accessible:true}];next.opposite=null;actual.setBasemap(i%2?'dark':'light');actual.render(createMapScene({allStations:catalog,selectedStationId:null,userPosition:position,locationPermission:permission,locationError,theme,route:next}));}},
		clearRenderedRoute:()=>actual?.render(createMapScene({allStations:catalog,selectedStationId:null,userPosition:position,locationPermission:permission,locationError,theme,route:null})),
		camera: (lat:number,lon:number,zoom:number)=>actual?.setCamera({lat,lon,zoom},true),
		fitRegion:()=>actual?.fitPoints([{lat:44.19,lon:25.8},{lat:44.8,lon:26.49}], 'overview') }});
</script>
<h1>Paritate renderer: {engine}</h1>
<output aria-label="Selected station IDs">{selections.join(',')}</output>
<div class="controls">
	<button onclick={()=>{theme=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;}}>Theme</button>
	<button onclick={()=>{lang=lang==='ro'?'en':'ro';}}>Language</button>
	<button onclick={()=>{catalog=[...catalog];route=route?structuredClone($state.snapshot(route)):null;}}>Poll snapshot</button>
	<button onclick={()=>{route={key:'synthetic66',lineId:72,lineName:'66',vehicleType:'CABLE_CAR',primary:null,opposite:null};}}>Line 66 synthetic</button>
	<button onclick={()=>{catalog=[...small,...Array.from({length:101},(_,i)=>({id:100+i,name:`Other ${i}`,description:'',lat:44.426,lon:26.102}))];}}>Dense stations</button>
	<button onclick={()=>{route=null;}}>Clear line</button>
	<button onclick={()=>showReal('66')}>Line 66 captured</button>
	<button onclick={()=>showReal('N109')}>N109 Isovolta</button>
	<button onclick={()=>{if(route)overview={id:(overview?.id??0)+1,routeKey:route.key};}}>Overview</button>
	<button onclick={()=>{position={lat:44.437,lon:26.12,accuracy:20};locationError=null;permission='granted';}}>Deliver GPS</button>
	<button onclick={()=>{position={lat:44.438,lon:26.121,accuracy:20};}}>Move GPS</button>
	<button onclick={()=>{position=null;locationError=null;permission='granted';}}>Clear GPS</button>
	<button onclick={()=>{locationError='Position unavailable';}}>Fail GPS</button>
	<button onclick={()=>{permission='denied';}}>Deny GPS</button>
	<button onclick={()=>{mounted=!mounted;}}>Toggle map</button>
</div>
{#if mounted}<MapView allStations={catalog} selectedStationId={selected} userPosition={position} locationPermission={permission}
	{locationError} {lang} {route} {theme} overviewRequest={overview} rendererFactory={factory}
	onStationSelect={s=>{selected=s.id;selections=[...selections,s.id];}}/>{/if}
<style>.controls{display:flex;gap:4px;flex-wrap:wrap}.controls button{min-height:32px}h1{font-size:1rem;margin:0}output{display:block}</style>
