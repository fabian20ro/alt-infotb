<script lang="ts">
	import { onMount } from 'svelte';
	import { STOP_ID } from '$lib/api/constants.js';
	import { createArrivalsStore, getCachedArrivals, cacheArrivals } from '$lib/stores/arrivals.svelte.js';
	import { createGeolocationStore } from '$lib/stores/geolocation.svelte.js';
	import { createSettingsStore } from '$lib/stores/settings.svelte.js';
	import { createFavoritesStore } from '$lib/stores/favorites.svelte.js';
	import { createRecentsStore } from '$lib/stores/recents.svelte.js';
	import { loadStations } from '$lib/stations/data.js';
	import { findNearestStations } from '$lib/stations/geo.js';
	import type { Station, StationWithDistance } from '$lib/stations/types.js';
	import StationHeader from '$lib/components/StationHeader.svelte';
	import StationArrivals from '$lib/components/StationArrivals.svelte';
	import MapView from '$lib/components/MapView.svelte';
	import DrawerMenu from '$lib/components/DrawerMenu.svelte';

	const arrivals = createArrivalsStore();
	const geo = createGeolocationStore();
	const settings = createSettingsStore();
	const favorites = createFavoritesStore();
	const recents = createRecentsStore();

	let allStations = $state<Station[]>([]);
	let nearbyStations = $state<StationWithDistance[]>([]);
	let selectedStation = $state<Station | null>(null);
	let drawerOpen = $state(false);

	let stationName = $derived(arrivals.state.data?.stationName ?? selectedStation?.name ?? '');
	let stationAddress = $derived(arrivals.state.data?.address ?? selectedStation?.description ?? '');
	let isFavorite = $derived(selectedStation ? favorites.isFavorite(selectedStation.id) : false);
	let displayRecents = $derived(() => {
		const favIds = new Set(favorites.favorites.map((f) => f.id));
		return recents.getExcluding(favIds);
	});

	function selectStation(station: Station) {
		selectedStation = station;
		arrivals.selectStation(station.id);
		recents.add(station);
	}

	function handleFavoriteToggle() {
		if (!selectedStation) return;
		favorites.toggle(selectedStation);
	}

	onMount(() => {
		// THREAD A: Load favorites and show first favorite immediately
		const favList = favorites.favorites;
		if (favList.length > 0) {
			const firstFav = favList[0];
			selectStation(firstFav);

			// Try cached arrivals for instant display
			const cached = getCachedArrivals();
			if (cached) {
				arrivals.state.data = cached;
			}
		} else {
			// Default station
			selectStation({ id: STOP_ID, name: 'Piata Unirii', description: 'Bd. Regina Maria, Bucuresti', lat: 44.42658, lon: 26.100225 });
		}

		// Start auto-refresh
		arrivals.toggleAutoRefresh();

		// THREAD B: Load station data
		loadStations().then((stations) => {
			allStations = stations;
			updateNearbyStations();
		});

		// THREAD C: Start GPS
		geo.startWatching();

		return () => {
			arrivals.cleanup();
			geo.stopWatching();
		};
	});

	function updateNearbyStations() {
		const center = geo.getCenter();
		if (allStations.length > 0) {
			nearbyStations = findNearestStations(center.lat, center.lon, allStations, 15);
		}
	}

	// Update nearby stations when GPS position changes
	$effect(() => {
		if (geo.position && allStations.length > 0) {
			updateNearbyStations();
		}
	});

	// Cache successful fetches
	$effect(() => {
		if (arrivals.state.status === 'success' && arrivals.state.data) {
			cacheArrivals(arrivals.state.data);
		}
	});
</script>

<svelte:head>
	<title>Better STB</title>
</svelte:head>

<DrawerMenu
	open={drawerOpen}
	favorites={favorites.favorites}
	recents={displayRecents()}
	theme={settings.theme}
	lang={settings.lang}
	onClose={() => drawerOpen = false}
	onSelectStation={selectStation}
	onThemeChange={(t) => settings.setTheme(t)}
	onLangChange={(l) => settings.setLang(l)}
/>

<main class="app-layout">
	<div class="arrivals-panel">
		<StationHeader
			{stationName}
			address={stationAddress}
			{isFavorite}
			onMenuToggle={() => drawerOpen = !drawerOpen}
			onFavoriteToggle={handleFavoriteToggle}
		/>
		<StationArrivals
			arrivals={arrivals.state.data?.arrivals ?? []}
			loading={arrivals.state.status === 'loading'}
			error={arrivals.state.error}
			autoRefreshEnabled={arrivals.autoRefreshEnabled}
			onRefresh={() => arrivals.refresh()}
			onToggleAutoRefresh={() => arrivals.toggleAutoRefresh()}
		/>
	</div>

	<MapView
		stations={nearbyStations}
		selectedStationId={selectedStation?.id ?? null}
		userPosition={geo.position}
		theme={settings.theme}
		onStationSelect={selectStation}
	/>
</main>

<style>
	.app-layout {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		overflow: hidden;
	}

	.arrivals-panel {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-inline: max(1rem, env(safe-area-inset-left));
		display: flex;
		flex-direction: column;
	}
</style>
