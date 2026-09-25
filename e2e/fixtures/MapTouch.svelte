<script lang="ts">
	import MapView, { type MapRouteOverlay } from '../../src/lib/components/MapView.svelte';
	import type { Station } from '../../src/lib/stations/types';
	import type { GeoPosition } from '../../src/lib/stores/geolocation.svelte';
	const routeFixture = location.search.includes('routes');
	const stations: Station[] = [
		{ id: 1, name: 'Stația A cu un nume foarte lung', description: '', lat: 44.4268, lon: 26.1025, lines: ['TROLLEYBUS:66'] },
		{ id: 2, name: 'Stația B', description: '', lat: location.search.includes('close') ? 44.4274 : 44.4281, lon: 26.1025, lines: ['TROLLEYBUS:66'] },
		...(routeFixture ? [
			{ id: 3, name: 'Sens întors', description: '', lat: 44.4253, lon: 26.1025, lines: ['TROLLEYBUS:66'] },
			{ id: 4, name: 'Altă linie', description: '', lat: 44.4268, lon: 26.1042, lines: ['TRAM:41'] }
		] : [])
	];
	let selected = $state<Station | null>(routeFixture ? stations[0] : null);
	let selections = $state<number[]>([]);
	let theme = $state<'light' | 'dark'>('dark');
	let catalog = $state(stations);
	let position = $state<GeoPosition | null>(location.search.includes('no-position')
		? null : { lat: stations[0].lat, lon: stations[0].lon, accuracy: 20 });
	let permission = $state<'granted' | 'denied'>('granted');
	let locationError = $state<string | null>(null);
	let lang = $state<'ro' | 'en'>('ro');
	let route = $state<MapRouteOverlay | null>(null);
	function selectLine(lineName: string, vehicleType: string) {
		route = { key: lineName, lineName, vehicleType, primary: null, opposite: null };
	}
</script>

<h1>{selected?.name ?? 'Selectează stația'}</h1>
<output aria-label="Selected station IDs">{selections.join(',')}</output>
<button onclick={() => { theme = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; }}>Theme</button>
<button onclick={() => { catalog = [...stations]; }}>Reload stations</button>
{#if location.search.includes('no-position')}
	<button onclick={() => {
		position = { lat: 44.437, lon: 26.12, accuracy: 20 };
		locationError = null;
		permission = 'granted';
	}}>Deliver GPS</button>
	<button onclick={() => { position = { lat: 44.438, lon: 26.121, accuracy: 20 }; }}>Move GPS</button>
	<button onclick={() => { locationError = 'Position unavailable'; }}>Fail GPS</button>
	<button onclick={() => { permission = 'denied'; }}>Deny GPS</button>
	<button onclick={() => { lang = 'en'; }}>English</button>
{/if}
{#if routeFixture}
	<button onclick={() => selectLine('66', 'TROLLEYBUS')}>Line 66</button>
	<button onclick={() => selectLine('41', 'TRAM')}>Line 41</button>
	<button onclick={() => { route = null; }}>Clear line</button>
	<button onclick={() => { catalog = [...stations, ...Array.from({ length: 101 }, (_, i) => ({
		id: 100 + i, name: `Other ${i}`, description: '', lat: 44.426, lon: 26.102
	}))]; }}>Dense stations</button>
{/if}
<MapView
	allStations={catalog}
	selectedStationId={selected?.id ?? null}
	userPosition={position}
	locationPermission={permission}
	{locationError}
	{lang}
	{route}
	{theme}
	onStationSelect={(station) => { selected = station; selections = [...selections, station.id]; }}
/>
