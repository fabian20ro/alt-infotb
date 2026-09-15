<script lang="ts">
	import MapView from '../../src/lib/components/MapView.svelte';
	import type { Station } from '../../src/lib/stations/types';
	const stations: Station[] = [
		{ id: 1, name: 'Stația A cu un nume foarte lung', description: '', lat: 44.4268, lon: 26.1025 },
		{ id: 2, name: 'Stația B', description: '', lat: location.search.includes('close') ? 44.4274 : 44.4281, lon: 26.1025 }
	];
	let selected = $state<Station | null>(null);
	let selections = $state<number[]>([]);
	let theme = $state<'light' | 'dark'>('dark');
	let catalog = $state(stations);
</script>

<h1>{selected?.name ?? 'Selectează stația'}</h1>
<output aria-label="Selected station IDs">{selections.join(',')}</output>
<button onclick={() => { theme = theme === 'dark' ? 'light' : 'dark'; }}>Theme</button>
<button onclick={() => { catalog = [...stations]; }}>Reload stations</button>
<MapView
	allStations={catalog}
	selectedStationId={selected?.id ?? null}
	userPosition={{ lat: stations[0].lat, lon: stations[0].lon, accuracy: 20 }}
	locationPermission="granted"
	{theme}
	onStationSelect={(station) => { selected = station; selections = [...selections, station.id]; }}
/>
