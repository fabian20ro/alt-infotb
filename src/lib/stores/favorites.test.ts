import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('favorites store', () => {
	beforeEach(() => {
		const store: Record<string, string> = {};
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => store[key] ?? null,
			setItem: (key: string, value: string) => { store[key] = value; },
			removeItem: (key: string) => { delete store[key]; },
			clear: () => { Object.keys(store).forEach((k) => delete store[k]); }
		});
	});

	it('starts with empty favorites', async () => {
		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();
		expect(store.favorites).toEqual([]);
	});

	it('loads favorites from localStorage', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([station]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();
		expect(store.favorites).toHaveLength(1);
		expect(store.favorites[0].id).toBe(3570);
	});

	it('isFavorite returns correct boolean', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([station]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();
		expect(store.isFavorite(3570)).toBe(true);
		expect(store.isFavorite(9999)).toBe(false);
	});

	it('remove() clears pinnedId when the removed station is pinned', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([station]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();

		store.togglePin(3570);
		expect(store.pinnedId).toBe(3570);

		store.remove(3570);
		expect(store.pinnedId).toBe(null);
	});

	it('handles corrupt JSON in localStorage gracefully', async () => {
		localStorage.setItem('alt-stb-favorites', 'not-valid-json{{{');

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();
		expect(store.favorites).toEqual([]);
	});

	it('togglePin persists pinned ID and reloads from localStorage', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([station]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();

		store.togglePin(3570);
		expect(JSON.parse(localStorage.getItem('alt-stb-pinned')!)).toBe(3570);

		const freshStore = createFavoritesStore();
		expect(freshStore.pinnedId).toBe(3570);
	});
});
