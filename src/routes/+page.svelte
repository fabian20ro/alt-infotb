<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { translations } from '$lib/i18n/translations.js';
	import type OfflineMapExperienceComponent from '$lib/components/OfflineMapExperience.svelte';
	import { STOP_ID } from '$lib/api/constants.js';
	import { createArrivalsStore, getCachedArrivals, cacheArrivals } from '$lib/stores/arrivals.svelte.js';
	import { createGeolocationStore } from '$lib/stores/geolocation.svelte.js';
	import { createSettingsStore } from '$lib/stores/settings.svelte.js';
	import { createFavoritesStore } from '$lib/stores/favorites.svelte.js';
	import { createRecentsStore } from '$lib/stores/recents.svelte.js';
	import { loadStations, stationCatalogMetadata } from '$lib/stations/data.js';
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
	let offlineOpen = $state(false);
	let offlineLoadFailed = $state(false);
	let OfflineMapExperience = $state<typeof OfflineMapExperienceComponent | null>(null);
	let overviewRequest = $state<{ id: number; routeKey: string } | null>(null);
	let overviewRequestId = 0;

	let stationName = $derived(arrivals.state.data?.stationName ?? selectedStation?.name ?? '');
	let stationAddress = $derived(arrivals.state.data?.address ?? selectedStation?.description ?? '');
	let isFavorite = $derived(selectedStation ? favorites.isFavorite(selectedStation.id) : false);
	let displayRecents = $derived(() => {
		const favIds = new Set(favorites.favorites.map((f) => f.id));
		return recents.getExcluding(favIds);
	});

	function closeOfflineMaps() {
		if (!offlineOpen) return;
		offlineOpen = false;
		void tick().then(() => { document.querySelector<HTMLButtonElement>('.station-header .menu-btn')?.focus(); });
	}

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
		arrivals.selectLine(arrival);
	}

	function showRouteOverview() {
		if (!arrivals.route) return;
		overviewRequestId += 1;
		overviewRequest = {
			id: overviewRequestId,
			routeKey: arrivals.route.key
		};
	}

	onMount(() => {
		let disposed = false;
		if (import.meta.env.MODE === 'offline-preview') {
			void import('$lib/components/OfflineMapExperience.svelte').then(module => {
				if (!disposed) OfflineMapExperience = module.default;
			}).catch(() => { if (!disposed) offlineLoadFailed = true; });
		}
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
			if (event.key === 'Escape' && !drawerOpen && !offlineOpen && arrivals.route) {
				arrivals.clearLine();
			}
		};

		document.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('focus', handleFocus);
		window.addEventListener('keydown', handleKeydown);

		// THREAD B: Load the versioned station catalog bundled with the PWA.
		const stations = loadStations();
		allStations = stations;
		arrivals.setStations(stations);

		// THREAD C: Start GPS
		geo.startWatching();

		return () => {
			disposed = true;
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
	<title>Alt InfoTB</title>
</svelte:head>

<DrawerMenu
	open={drawerOpen}
	favorites={favorites.favorites}
	recents={displayRecents()}
	theme={settings.theme}
	lang={settings.lang}
	catalogVersion={stationCatalogMetadata.feedVersion}
	catalogUpdatedAt={stationCatalogMetadata.sourceUpdatedAt}
	onClose={() => drawerOpen = false}
	onSelectStation={selectStation}
	onThemeChange={(t) => settings.setTheme(t)}
	onLangChange={(l) => settings.setLang(l)}
	pinnedId={favorites.pinnedId}
	onTogglePin={(id) => favorites.togglePin(id)}
	onRemoveRecent={(id) => recents.remove(id)}
	onOfflineMaps={OfflineMapExperience ? () => { offlineOpen = true; } : undefined}
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
			primaryDirection={arrivals.route.primary?.direction ?? arrivals.route.direction}
			oppositeDirection={arrivals.route.opposite?.direction ?? ''}
			status={arrivals.route.status}
			primaryCount={arrivals.route.primaryAvailable
				? arrivals.route.primary?.vehicles.length ?? 0
				: null}
			oppositeCount={arrivals.route.oppositeAvailable
				? arrivals.route.opposite?.vehicles.length ?? 0
				: null}
			primaryColor={arrivals.route.primary?.color ?? arrivals.route.opposite?.color}
			lang={settings.lang}
			onOverview={showRouteOverview}
			onClose={() => arrivals.clearLine()}
		/>
	{/if}

	{#if offlineLoadFailed}<p class="offline-load-error" role="alert">{translations[settings.lang].offlineLoadFailed}</p>{/if}
	{#if import.meta.env.MODE === 'offline-preview' && !OfflineMapExperience && !offlineLoadFailed}
		<div class="offline-loading" role="status">{translations[settings.lang].offlineStarting}</div>
	{:else if OfflineMapExperience}
	<OfflineMapExperience
		open={offlineOpen}
		onClose={closeOfflineMaps}
		{allStations}
		selectedStationId={selectedStation?.id ?? null}
		userPosition={geo.position}
		locationPermission={geo.permission}
		locationError={geo.error}
		lang={settings.lang}
		theme={settings.theme}
		route={arrivals.route}
		{overviewRequest}
		onStationSelect={selectStation}
	/>
	{:else}
	<MapView
		{allStations}
		selectedStationId={selectedStation?.id ?? null}
		userPosition={geo.position}
		locationPermission={geo.permission}
		locationError={geo.error}
		lang={settings.lang}
		theme={settings.theme}
		route={arrivals.route}
		{overviewRequest}
		onStationSelect={selectStation}
	/>
	{/if}
</main>

<style>
	.offline-loading { height: min(50dvh, 100vw); flex-shrink: 0; display: grid; place-items: center; color: var(--color-text-muted); background: var(--color-surface); }
	.offline-load-error { margin: 0; padding: .5rem 1rem; background: var(--color-surface); color: var(--color-text); font-size: .85rem; }
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
