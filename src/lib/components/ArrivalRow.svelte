<script lang="ts">
	import { LINE_COLORS } from '$lib/api/constants.js';
	import { formatArrivalTime } from '$lib/stores/arrivals.js';
	import type { ArrivalInfo } from '$lib/api/types.js';

	interface Props {
		arrival: ArrivalInfo;
		loading?: boolean;
	}

	let { arrival, loading = false }: Props = $props();

	let color = $derived(LINE_COLORS[arrival.lineName] ?? '#888');
</script>

<div class="arrival-row">
	<div class="line-info">
		<span class="line-badge" style="background-color: {color}">
			{arrival.lineName}
		</span>
		{#if arrival.direction}
			<span class="direction">{arrival.direction}</span>
		{/if}
	</div>
	<div class="times">
		{#if loading}
			<span class="skeleton">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
			<span class="skeleton">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
		{:else if arrival.arrivingTimes.length === 0}
			<span class="no-data">--</span>
		{:else}
			{#each arrival.arrivingTimes as time, i}
				<span class="time" class:first={i === 0}>
					{formatArrivalTime(time)}
				</span>
			{/each}
		{/if}
	</div>
</div>

<style>
	.arrival-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-border);
	}

	.arrival-row:last-child {
		border-bottom: none;
	}

	.line-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		flex-shrink: 1;
	}

	.line-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.75rem;
		padding: 0.25rem 0.5rem;
		border-radius: 0.5rem;
		color: #fff;
		font-weight: 700;
		font-size: 1.25rem;
		text-align: center;
		flex-shrink: 0;
	}

	.direction {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.times {
		display: flex;
		gap: 0.75rem;
		flex-shrink: 0;
	}

	.time {
		font-size: 1.1rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.time.first {
		color: var(--color-text);
		font-weight: 600;
	}

	.no-data {
		color: var(--color-text-muted);
		font-style: italic;
	}

	.skeleton {
		background: var(--color-skeleton);
		border-radius: 0.25rem;
		animation: pulse 1.5s ease-in-out infinite;
		color: transparent;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 0.8;
		}
	}
</style>
