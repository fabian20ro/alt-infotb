<script lang="ts">
	import { translations } from '$lib/i18n/translations.js';
	import type { SelectedRouteStatus } from '$lib/stores/arrivals.svelte.js';
	import type { Lang } from '$lib/stores/settings.svelte.js';

	interface Props {
		lineName: string;
		primaryDirection: string;
		oppositeDirection: string;
		status: SelectedRouteStatus;
		primaryCount: number | null;
		oppositeCount: number | null;
		primaryColor?: string;
		lang: Lang;
		onOverview: () => void;
		onClose: () => void;
	}

	let {
		lineName,
		primaryDirection,
		oppositeDirection,
		status,
		primaryCount,
		oppositeCount,
		primaryColor = '#0077b6',
		lang,
		onOverview,
		onClose
	}: Props = $props();

	function safeColor(color: string): string {
		return /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#0077b6';
	}

	let strings = $derived(translations[lang]);
	let markerColor = $derived(safeColor(primaryColor));

	function directionLabel(direction: string, fallback: string): string {
		return direction ? `${strings.towards} ${direction}` : fallback;
	}

	function visibleVehicleCount(count: number | null): string {
		if (count !== null) return String(count);
		return status === 'loading' ? '…' : '—';
	}

	let primaryDestination = $derived(directionLabel(primaryDirection, strings.selectedDirection));
	let oppositeDestination = $derived(directionLabel(oppositeDirection, strings.oppositeDirection));
	let primaryVisibleCount = $derived(visibleVehicleCount(primaryCount));
	let oppositeVisibleCount = $derived(visibleVehicleCount(oppositeCount));

	function formatVehicleCount(count: number | null): string {
		if (count === null) return strings.dataUnavailable;
		if (count === 1) return strings.vehicleOne;
		return strings.vehicleMany.replace('{count}', String(count));
	}

	let primaryAriaLabel = $derived(
		`${strings.filledMarker}, ${primaryDestination}: ${formatVehicleCount(primaryCount)}`
	);
	let oppositeAriaLabel = $derived(
		`${strings.yellowRingMarker}, ${oppositeDestination}: ${formatVehicleCount(oppositeCount)}`
	);
	let message = $derived.by(() => {
		switch (status) {
			case 'loading':
				return strings.routeLoading;
			case 'partial':
				return strings.routePartial;
			case 'empty':
				return strings.noLiveVehicles;
			case 'error':
				return strings.routeUnavailable;
			default:
				return '';
		}
	});
</script>

<section class="route-status" aria-label={strings.routeDetails}>
	<div class="route-copy" role="status" aria-live="polite">
		<span class="route-line">{lineName}</span>
		<ul class="direction-legend" aria-label={strings.vehicleLegend}>
			<li aria-label={primaryAriaLabel}>
				<span class="legend-marker primary" style:background-color={markerColor} aria-hidden="true"></span>
				<span class="destination">{primaryDestination}</span>
				<strong>{primaryVisibleCount}</strong>
			</li>
			<li aria-label={oppositeAriaLabel}>
				<span class="legend-marker opposite" aria-hidden="true"></span>
				<span class="destination">{oppositeDestination}</span>
				<strong>{oppositeVisibleCount}</strong>
			</li>
		</ul>
		{#if message}
			<p class:partial={status === 'partial'} class:error={status === 'error'}>{message}</p>
		{/if}
	</div>
	<div class="route-actions">
		<button type="button" class="overview" onclick={onOverview} aria-label={strings.routeOverview} title={strings.routeOverview}>
			<svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
				<path d="M9 3v15M15 6v15" />
			</svg>
		</button>
		<button type="button" class="close" onclick={onClose} aria-label={strings.closeRoute} title={strings.closeRoute}>×</button>
	</div>
</section>

<style>
	.route-status {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 3.75rem;
		padding: 0.5rem max(0.75rem, env(safe-area-inset-left));
		border-top: 1px solid var(--color-border);
		background: var(--color-surface);
		box-shadow: 0 -2px 8px rgb(0 0 0 / 0.12);
		z-index: 2;
	}

	.route-copy {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		column-gap: 0.65rem;
		min-width: 0;
		flex: 1;
	}

	.route-line {
		font-weight: 800;
		font-size: 1rem;
		color: var(--color-text);
	}

	.direction-legend {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.direction-legend li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		flex: 1 1 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.legend-marker {
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.legend-marker.primary {
		border: 2px solid #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.35);
	}

	.legend-marker.opposite {
		border: 3px solid var(--color-warning);
		background: var(--color-surface);
	}

	.destination {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.direction-legend strong {
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}

	p {
		grid-column: 1 / -1;
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		line-height: 1.2;
		color: var(--color-text-muted);
	}

	p.partial { color: var(--color-warning); }
	p.error { color: var(--color-error); }

	.route-actions {
		display: flex;
		gap: 0.35rem;
	}

	button {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}

	button:hover { background: var(--color-surface-hover); }
	button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
	.close { font-size: 1.65rem; line-height: 1; }

	@media (max-width: 420px) {
		.direction-legend { gap: 0.5rem; }
		.route-copy { column-gap: 0.5rem; }
	}
</style>
