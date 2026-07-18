<script lang="ts">
	import { onMount } from 'svelte';
	import { STOP_ID } from '$lib/api/constants.js';
	import { createArrivalsStore, getCachedArrivals, cacheArrivals } from '$lib/stores/arrivals.svelte.js';
	import { createGeolocationStore } from '$lib/stores/geolocation.svelte.js';
	import { createSettingsStore } from '$lib/stores/settings.svelte.js';
	import { createFavoritesStore } from '$lib/stores/favorites.svelte.js';
	import { createRecentsStore } from '$lib/stores/recents.svelte.js';
	import { loadStations } from '$lib/stations/data.js';
	import { getLastRefreshTime } from '$lib/stations/db.js';
	import type { Station } from '$lib/stations/types.js';
	import type { ArrivalInfo } from '$lib/api/types.js';
	import StationHeader from '$lib/components/StationHeader.svelte';
	import StationArrivals from '$lib/components/StationArrivals.svelte';
	import MapView from '$lib/components/MapView.svelte';
	import RouteStatus from '$lib/components/RouteStatus.svelte';
	import DrawerMenu from '$lib/components/DrawerMenu.svelte';

	const arrivals = createArrivalsStore();
	const geo = createGeolocationStore();
	const settings = createSettingsStore();
	const favorites = createFavoritesStore();
	const recents = createRecentsStore();

	let allStations = $state<Station[]>([]);
	let selectedStation = $state<Station | null>(null);
	let drawerOpen = $state(false);
	let lastDataUpdate = $state<number>(0);
	let overviewRequest = $state(0);

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

	function selectLine(arrival: ArrivalInfo) {
		if (!selectedStation) return;
		arrivals.selectLine(arrival, { lat: selectedStation.lat, lng: selectedStation.lon });
	}

	onMount(() => {
		// THREAD A: Load startup station (pinned → first favorite → default)
		const startupStation = favorites.pinnedStation
			?? (favorites.favorites.length > 0 ? favorites.favorites[0] : null)
			?? { id: STOP_ID, name: 'Piata Unirii', description: 'Bd. Regina Maria, Bucuresti', lat: 44.42658, lon: 26.100225 };
		selectStation(startupStation);

		// Try cached arrivals for instant display
		const cached = getCachedArrivals();
		if (cached) {
			arrivals.state.data = cached;
		}

		const handleVisibilityChange = () => {
			if (document.hidden) {
				arrivals.onHidden();
			} else {
				arrivals.onVisible();
			}
		};

		const handleFocus = () => {
			arrivals.onVisible();
		};

		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !drawerOpen && arrivals.route) {
				arrivals.clearLine();
			}
		};

		document.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('focus', handleFocus);
		window.addEventListener('keydown', handleKeydown);

		// THREAD B: Load station data + update timestamp after background refresh
		loadStations().then(({ stations, refreshDone }) => {
			allStations = stations;
			// Read initial timestamp immediately
			getLastRefreshTime().then((t) => { lastDataUpdate = t; });
			// Re-read after background staleness check completes (may have updated it)
			refreshDone.then(() => {
				getLastRefreshTime().then((t) => { lastDataUpdate = t; });
			});
		});

		// THREAD C: Start GPS
		geo.startWatching();

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('focus', handleFocus);
			window.removeEventListener('keydown', handleKeydown);
			arrivals.cleanup();
			geo.stopWatching();
		};
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
	{lastDataUpdate}
	onClose={() => drawerOpen = false}
	onSelectStation={selectStation}
	onThemeChange={(t) => settings.setTheme(t)}
	onLangChange={(l) => settings.setLang(l)}
	pinnedId={favorites.pinnedId}
	onTogglePin={(id) => favorites.togglePin(id)}
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
			lang={settings.lang}
			onRefresh={() => arrivals.refresh()}
			selectedKey={arrivals.route?.key ?? null}
			selecting={arrivals.route?.status === 'loading'}
			onLineSelect={selectLine}
		/>
	</div>

	{#if arrivals.route}
		<RouteStatus
			lineName={arrivals.route.lineName}
			direction={arrivals.route.direction}
			status={arrivals.route.status}
			vehicleCount={arrivals.route.primary?.vehicles.length ?? 0}
			oppositeCount={arrivals.route.opposite?.vehicles.length ?? 0}
			turnaroundCount={arrivals.route.turnaroundVehicleIds.length}
			lang={settings.lang}
			onOverview={() => overviewRequest += 1}
			onClose={() => arrivals.clearLine()}
		/>
	{/if}

	<MapView
		{allStations}
		selectedStationId={selectedStation?.id ?? null}
		userPosition={geo.position}
		locationPermission={geo.permission}
		theme={settings.theme}
		route={arrivals.route}
		{overviewRequest}
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
