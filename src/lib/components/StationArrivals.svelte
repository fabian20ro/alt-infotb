<script lang="ts">
	import type { ArrivalInfo } from '$lib/api/types.js';
	import ArrivalRow from './ArrivalRow.svelte';

	interface Props {
		arrivals: ArrivalInfo[];
		loading: boolean;
		error: string | null;
		autoRefreshEnabled: boolean;
		onRefresh: () => void;
		onToggleAutoRefresh: () => void;
	}

	let { arrivals, loading, error, autoRefreshEnabled, onRefresh, onToggleAutoRefresh }: Props = $props();

	let isFirstLoad = $derived(loading && arrivals.length === 0);
</script>

<div class="station-arrivals">
	{#if error && arrivals.length === 0}
		<div class="error-state">
			<p class="error-message">Nu am putut contacta STB.</p>
			<p class="error-detail">{error}</p>
			<button class="retry-btn" onclick={onRefresh}>Încearcă din nou</button>
		</div>
	{:else if isFirstLoad}
		<div class="arrivals-list">
			{#each [1, 2, 3] as i (i)}
				<ArrivalRow
					arrival={{ lineName: '', lineId: 0, vehicleType: '', color: '#888', direction: '', arrivingTimes: [] }}
					loading={true}
				/>
			{/each}
		</div>
	{:else if arrivals.length === 0}
		<p class="no-arrivals">Nicio linie la această stație.</p>
	{:else}
		<div class="arrivals-list">
			{#each arrivals as arrival (arrival.lineName + arrival.direction)}
				<ArrivalRow {arrival} />
			{/each}
		</div>
	{/if}

	<div class="refresh-bar">
		<label class="auto-refresh">
			<input type="checkbox" checked={autoRefreshEnabled} onchange={onToggleAutoRefresh} />
			<span>auto-refresh 30s</span>
		</label>
		{#if loading}
			<span class="loading-indicator">Se actualizează...</span>
		{/if}
	</div>
</div>

<style>
	.station-arrivals {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.arrivals-list {
		flex: 1;
		overflow-y: auto;
	}

	.error-state {
		text-align: center;
		padding: 1.5rem 1rem;
	}

	.error-message {
		font-size: 1rem;
		color: var(--color-error);
		margin: 0 0 0.5rem 0;
	}

	.error-detail {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0 0 1rem 0;
		word-break: break-word;
	}

	.retry-btn {
		padding: 0.5rem 1.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
		cursor: pointer;
	}

	.retry-btn:hover {
		background: var(--color-surface-hover);
	}

	.no-arrivals {
		text-align: center;
		color: var(--color-text-muted);
		padding: 2rem 0;
		font-size: 0.9rem;
	}

	.refresh-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0;
		border-top: 1px solid var(--color-border);
		font-size: 0.8rem;
	}

	.auto-refresh {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-muted);
		cursor: pointer;
		user-select: none;
	}

	.auto-refresh input[type='checkbox'] {
		accent-color: var(--color-accent);
	}

	.loading-indicator {
		color: var(--color-accent);
		font-size: 0.75rem;
	}
</style>
