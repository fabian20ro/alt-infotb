<script lang="ts">
	import { formatArrivalTime } from '$lib/stores/arrivals.svelte.js';
	import type { ArrivalInfo } from '$lib/api/types.js';

	interface Props {
		arrival: ArrivalInfo;
		loading?: boolean;
		selected?: boolean;
		busy?: boolean;
		onSelect?: () => void;
	}

	let {
		arrival,
		loading = false,
		selected = false,
		busy = false,
		onSelect
	}: Props = $props();

	let color = $derived(arrival.color || '#888');
</script>

{#snippet rowContent()}
	<div class="line-info">
		<span class="line-badge" style="background-color: {color}">
			{arrival.lineName}
		</span>
		{#if arrival.direction}
			<span class="direction">{arrival.direction}</span>
		{/if}
		{#if busy}
			<span class="busy-indicator" aria-hidden="true"></span>
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
{/snippet}

{#if loading}
	<div class="arrival-row arrival-row-skeleton">
		{@render rowContent()}
	</div>
{:else}
	<button
		type="button"
		class="arrival-row"
		class:selected
		disabled={!onSelect}
		onclick={onSelect}
		aria-pressed={onSelect ? selected : undefined}
		aria-busy={busy}
	>
		{@render rowContent()}
	</button>
{/if}

<style>
	.arrival-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		min-height: 56px;
		padding: 0.75rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		border-top: 0;
		border-right: 0;
		border-left: 0;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color 0.15s ease, box-shadow 0.15s ease;
	}

	.arrival-row:last-child {
		border-bottom: none;
	}

	.arrival-row:not(:disabled):hover {
		background: var(--color-surface-hover);
	}

	.arrival-row:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
		border-radius: 0.5rem;
	}

	.arrival-row.selected {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		box-shadow: inset 3px 0 0 var(--color-accent);
	}

	.arrival-row:disabled,
	.arrival-row-skeleton {
		cursor: default;
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

	.busy-indicator {
		width: 0.875rem;
		height: 0.875rem;
		flex-shrink: 0;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
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

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.arrival-row {
			transition: none;
		}

		.skeleton,
		.busy-indicator {
			animation: none;
		}

		.skeleton {
			opacity: 0.6;
		}
	}
</style>
