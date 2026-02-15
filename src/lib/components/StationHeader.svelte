<script lang="ts">
	interface Props {
		stationName: string;
		address: string;
		isFavorite: boolean;
		onMenuToggle: () => void;
		onFavoriteToggle: () => void;
	}

	let { stationName, address, isFavorite, onMenuToggle, onFavoriteToggle }: Props = $props();
</script>

<header class="station-header">
	<button class="menu-btn" onclick={onMenuToggle} aria-label="Meniu">
		<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
			<line x1="3" y1="6" x2="21" y2="6" />
			<line x1="3" y1="12" x2="21" y2="12" />
			<line x1="3" y1="18" x2="21" y2="18" />
		</svg>
	</button>
	<div class="station-info">
		<h1 class="station-name">{stationName}</h1>
		{#if address}
			<p class="station-address">{address}</p>
		{/if}
	</div>
	<button class="fav-btn" class:active={isFavorite} onclick={onFavoriteToggle} aria-label={isFavorite ? 'Elimină din favorite' : 'Adaugă la favorite'}>
		<svg width="22" height="22" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
		</svg>
	</button>
</header>

<style>
	.station-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0;
		min-height: 48px;
	}

	.menu-btn,
	.fav-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
		flex-shrink: 0;
		transition: background-color 0.15s;
	}

	.menu-btn:hover,
	.fav-btn:hover {
		background: var(--color-surface-hover);
	}

	.fav-btn.active {
		color: var(--color-warning);
	}

	.station-info {
		flex: 1;
		min-width: 0;
	}

	.station-name {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.station-address {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0.125rem 0 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
