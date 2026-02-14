<script lang="ts">
	import { onMount } from 'svelte';
	import { STATION_NAME, LINE_ORDER } from '$lib/api/constants.js';
	import { createArrivalsStore, getCachedArrivals, cacheArrivals } from '$lib/stores/arrivals.js';
	import type { ArrivalInfo } from '$lib/api/types.js';
	import ArrivalRow from './ArrivalRow.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import LastUpdated from './LastUpdated.svelte';

	const store = createArrivalsStore();

	/** Show stale data warning if data is older than 5 minutes */
	let isStale = $derived(
		store.state.data?.fetchedAt
			? Date.now() - store.state.data.fetchedAt.getTime() > 5 * 60 * 1000
			: false
	);

	/** Placeholder rows for loading state */
	const placeholderArrivals: ArrivalInfo[] = LINE_ORDER.map((name) => ({
		lineName: name,
		lineId: 0,
		vehicleType: 'TRAM',
		color: '#BE1622',
		direction: '',
		arrivingTimes: []
	}));

	let displayArrivals = $derived(store.state.data?.arrivals ?? placeholderArrivals);

	onMount(() => {
		// Try to show cached data immediately
		const cached = getCachedArrivals();
		if (cached) {
			store.state.data = cached;
		}

		// Fetch fresh data
		store.refresh();

		return () => store.cleanup();
	});

	// Cache successful fetches
	$effect(() => {
		if (store.state.status === 'success' && store.state.data) {
			cacheArrivals(store.state.data);
		}
	});
</script>

<div class="arrival-board">
	<header class="board-header">
		<h1>{store.state.data?.stationName ?? STATION_NAME}</h1>
	</header>

	<div class="board-content">
		{#if store.state.status === 'error' && !store.state.data}
			<div class="error-state">
				<p class="error-message">Nu am putut contacta STB.</p>
				<p class="error-detail">{store.state.error}</p>
				<button class="retry-btn" onclick={() => store.refresh()}>Încearcă din nou</button>
			</div>
		{:else}
			<div class="arrivals-list">
				{#each displayArrivals as arrival (arrival.lineName)}
					<ArrivalRow {arrival} loading={store.state.status === 'loading' && !store.state.data} />
				{/each}
			</div>
		{/if}
	</div>

	<footer class="board-footer">
		<LastUpdated date={store.state.data?.fetchedAt ?? null} stale={isStale} />
		<RefreshButton
			onRefresh={() => store.refresh()}
			loading={store.state.status === 'loading'}
			autoRefreshEnabled={store.autoRefreshEnabled}
			onToggleAutoRefresh={() => store.toggleAutoRefresh()}
		/>
	</footer>
</div>

<style>
	.arrival-board {
		max-width: 28rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	.board-header h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 1.5rem 0;
		color: var(--color-text);
	}

	.board-content {
		flex: 1;
	}

	.arrivals-list {
		margin-bottom: 1.5rem;
	}

	.board-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	.error-state {
		text-align: center;
		padding: 2rem 1rem;
	}

	.error-message {
		font-size: 1.1rem;
		color: var(--color-error);
		margin: 0 0 0.5rem 0;
	}

	.error-detail {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0 0 1.5rem 0;
		white-space: pre-line;
		word-break: break-word;
	}

	.retry-btn {
		padding: 0.5rem 1.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 1rem;
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.retry-btn:hover {
		background: var(--color-surface-hover);
	}
</style>
