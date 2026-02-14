<script lang="ts">
	import { formatTime } from '$lib/stores/arrivals.js';

	interface Props {
		date: Date | null;
		stale?: boolean;
	}

	let { date, stale = false }: Props = $props();
</script>

{#if date}
	<div class="last-updated" class:stale>
		<span>actualizat: {formatTime(date)}</span>
		{#if stale}
			<span class="stale-warning">(date vechi)</span>
		{/if}
	</div>
{/if}

<style>
	.last-updated {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.stale {
		color: var(--color-warning);
	}

	.stale-warning {
		font-style: italic;
	}
</style>
