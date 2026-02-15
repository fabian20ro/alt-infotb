<script lang="ts">
	import type { Station } from '$lib/stations/types.js';
	import type { Theme, Lang } from '$lib/stores/settings.svelte.js';
	import { formatLastUpdate } from '$lib/stations/format.js';

	interface Props {
		open: boolean;
		favorites: Station[];
		recents: Station[];
		theme: Theme;
		lang: Lang;
		lastDataUpdate: number;
		onClose: () => void;
		onSelectStation: (station: Station) => void;
		onThemeChange: (theme: Theme) => void;
		onLangChange: (lang: Lang) => void;
	}

	let { open, favorites, recents, theme, lang, lastDataUpdate, onClose, onSelectStation, onThemeChange, onLangChange }: Props = $props();

	function handleStationClick(station: Station) {
		onSelectStation(station);
		onClose();
	}

	function handleBackdropClick() {
		onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="backdrop" class:visible={open} onclick={handleBackdropClick} onkeydown={handleKeydown} role="button" tabindex="-1" aria-label="Închide meniul"></div>
{/if}

<nav class="drawer" class:open aria-label="Meniu navigare">
	<div class="drawer-content">
		<section class="drawer-section">
			<h2 class="section-title">{lang === 'ro' ? 'Favorite' : 'Favorites'}</h2>
			{#if favorites.length === 0}
				<p class="empty-text">{lang === 'ro' ? 'Niciun favorit' : 'No favorites'}</p>
			{:else}
				<ul class="station-list">
					{#each favorites as station (station.id)}
						<li>
							<button class="station-item" onclick={() => handleStationClick(station)}>
								<span class="station-item-icon">★</span>
								<span class="station-item-name">{station.name}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="drawer-section">
			<h2 class="section-title">{lang === 'ro' ? 'Recente' : 'Recent'}</h2>
			{#if recents.length === 0}
				<p class="empty-text">{lang === 'ro' ? 'Nicio stație recentă' : 'No recent stations'}</p>
			{:else}
				<ul class="station-list">
					{#each recents as station (station.id)}
						<li>
							<button class="station-item" onclick={() => handleStationClick(station)}>
								<span class="station-item-icon">◷</span>
								<span class="station-item-name">{station.name}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<hr class="divider" />

		<section class="drawer-section settings-section">
			<div class="setting-row">
				<span class="setting-label">{lang === 'ro' ? 'Temă' : 'Theme'}</span>
				<div class="toggle-group">
					<button
						class="toggle-btn"
						class:active={theme === 'light'}
						onclick={() => onThemeChange('light')}
					>
						{lang === 'ro' ? 'Deschisă' : 'Light'}
					</button>
					<button
						class="toggle-btn"
						class:active={theme === 'dark'}
						onclick={() => onThemeChange('dark')}
					>
						{lang === 'ro' ? 'Întunecată' : 'Dark'}
					</button>
				</div>
			</div>
			<div class="setting-row">
				<span class="setting-label">{lang === 'ro' ? 'Limbă' : 'Language'}</span>
				<div class="toggle-group">
					<button
						class="toggle-btn"
						class:active={lang === 'ro'}
						onclick={() => onLangChange('ro')}
					>
						RO
					</button>
					<button
						class="toggle-btn"
						class:active={lang === 'en'}
						onclick={() => onLangChange('en')}
					>
						EN
					</button>
				</div>
			</div>
		</section>

		{#if lastDataUpdate}
			<p class="last-update">
				{lang === 'ro' ? 'Date actualizate' : 'Data updated'}: {formatLastUpdate(lastDataUpdate, lang)}
			</p>
		{/if}

		<div class="build-badge">
			<a href="https://github.com/fabian20ro/better-stb/actions/workflows/deploy.yml"
				 target="_blank" rel="noopener noreferrer">
				<img src="https://github.com/fabian20ro/better-stb/actions/workflows/deploy.yml/badge.svg"
						 alt="Build status" height="20" />
			</a>
		</div>
	</div>
</nav>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 900;
		opacity: 0;
		transition: opacity 0.25s ease;
	}

	.backdrop.visible {
		opacity: 1;
	}

	.drawer {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		width: min(280px, 80vw);
		background: var(--color-bg);
		z-index: 950;
		transform: translateX(-100%);
		transition: transform 0.25s ease;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.drawer.open {
		transform: translateX(0);
	}

	.drawer-content {
		padding: 1.5rem 1rem;
	}

	.drawer-section {
		margin-bottom: 1.5rem;
	}

	.section-title {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		margin: 0 0 0.75rem 0;
	}

	.empty-text {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
	}

	.station-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.station-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 0.5rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--color-text);
		font-size: 0.9rem;
		cursor: pointer;
		text-align: left;
		transition: background-color 0.15s;
	}

	.station-item:hover {
		background: var(--color-surface-hover);
	}

	.station-item-icon {
		flex-shrink: 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.station-item-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.divider {
		border: none;
		border-top: 1px solid var(--color-border);
		margin: 1rem 0;
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.setting-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.setting-label {
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.toggle-group {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		overflow: hidden;
	}

	.toggle-btn {
		padding: 0.375rem 0.75rem;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.toggle-btn:not(:last-child) {
		border-right: 1px solid var(--color-border);
	}

	.toggle-btn.active {
		background: var(--color-accent);
		color: #000;
		font-weight: 600;
	}

	.last-update {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-align: center;
		margin: 1.5rem 0 0;
	}

	.build-badge {
		margin-top: 0.5rem;
		text-align: center;
		opacity: 0.6;
	}

	.build-badge:hover {
		opacity: 1;
	}
</style>
