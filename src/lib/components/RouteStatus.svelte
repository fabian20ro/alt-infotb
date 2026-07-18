<script lang="ts">
	import { translations } from '$lib/i18n/translations.js';
	import type { Lang } from '$lib/stores/settings.svelte.js';

	export type RouteUiStatus =
		| 'loading'
		| 'ready'
		| 'checking-opposite'
		| 'fallback'
		| 'empty'
		| 'positions-error'
		| 'error';

	interface Props {
		lineName: string;
		direction: string;
		status: RouteUiStatus;
		vehicleCount: number;
		oppositeCount: number;
		turnaroundCount: number;
		lang: Lang;
		onOverview: () => void;
		onClose: () => void;
	}

	let {
		lineName,
		direction,
		status,
		vehicleCount,
		oppositeCount,
		turnaroundCount,
		lang,
		onOverview,
		onClose
	}: Props = $props();

	let strings = $derived(translations[lang]);
	let message = $derived.by(() => {
		switch (status) {
			case 'loading':
				return strings.routeLoading;
			case 'checking-opposite':
				return strings.checkingOpposite;
			case 'fallback':
				return turnaroundCount > 0
					? strings.turnaroundCandidate
					: strings.oppositeFound.replace('{count}', String(oppositeCount));
			case 'empty':
				return strings.noLiveVehicles;
			case 'error':
				return strings.routeUnavailable;
			case 'positions-error':
				return strings.positionsUnavailable;
			default:
				return vehicleCount === 1
					? strings.vehicleCountOne
					: strings.vehicleCountMany.replace('{count}', String(vehicleCount));
		}
	});
</script>

<section class="route-status" aria-label={strings.routeDetails}>
	<div class="route-copy" role="status" aria-live="polite">
		<div class="route-title">
			<span class="route-line">{lineName}</span>
			{#if direction}<span class="route-direction">{strings.towards} {direction}</span>{/if}
		</div>
		<p class:fallback={status === 'fallback'} class:error={status === 'error'}>{message}</p>
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
		min-width: 0;
		flex: 1;
	}

	.route-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.route-line {
		font-weight: 800;
		font-size: 1rem;
		color: var(--color-text);
	}

	.route-direction {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	p {
		margin: 0.15rem 0 0;
		font-size: 0.75rem;
		line-height: 1.2;
		color: var(--color-text-muted);
	}

	p.fallback { color: var(--color-warning); }
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
</style>
