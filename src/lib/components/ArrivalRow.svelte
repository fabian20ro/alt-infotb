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
	<span class="line-badge" style="background-color: {color}">
		{arrival.lineName}
	</span>
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
		gap: 1rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--color-border);
	}

	.arrival-row:last-child {
		border-bottom: none;
	}

	.line-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 3rem;
		padding: 0.25rem 0.5rem;
		border-radius: 0.5rem;
		color: #fff;
		font-weight: 700;
		font-size: 1.25rem;
		text-align: center;
	}

	.times {
		display: flex;
		gap: 1rem;
		flex: 1;
	}

	.time {
		font-size: 1.1rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
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
