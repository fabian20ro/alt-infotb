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

	it('add() prevents duplicate stations', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();

		store.add(station);
		store.add(station);
		expect(store.favorites).toHaveLength(1);
	});

	it('remove() does not clear pinnedId when station is not pinned', async () => {
		const stationA = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		const stationB = { id: 9999, name: 'Gara de Nord', description: '', lat: 44.43, lon: 26.08 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([stationA, stationB]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();

		store.togglePin(3570);
		expect(store.pinnedId).toBe(3570);

		store.remove(9999);
		expect(store.favorites).toHaveLength(1);
		expect(store.pinnedId).toBe(3570);
	});

	it('togglePin unpins when already pinned', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([station]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();

		store.togglePin(3570);
		expect(store.pinnedId).toBe(3570);

		store.togglePin(3570);
		expect(store.pinnedId).toBe(null);
	});

	it('pinnedStation returns null when no pin', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([station]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();

		expect(store.pinnedStation).toBeNull();
	});

	it('pinnedStation returns station when pin matches a favorite', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([station]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();

		store.togglePin(3570);
		expect(store.pinnedStation).toEqual(station);
	});

	it('toggle() adds a non-favorited station', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();

		store.toggle(station);
		expect(store.favorites).toHaveLength(1);
		expect(store.isFavorite(3570)).toBe(true);
	});

	it('toggle() removes an already-favorited station', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([station]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();
		expect(store.isFavorite(3570)).toBe(true);

		store.toggle(station);
		expect(store.favorites).toHaveLength(0);
		expect(store.isFavorite(3570)).toBe(false);
	});

	it('persistFavorites writes the correct JSON to localStorage after add', async () => {
		const station = { id: 3570, name: 'Piata Unirii', description: '', lat: 44.4, lon: 26.1 };
		localStorage.setItem('alt-stb-favorites', JSON.stringify([]));

		const { createFavoritesStore } = await import('./favorites.svelte.js');
		const store = createFavoritesStore();

		store.add(station);
		const stored = JSON.parse(localStorage.getItem('alt-stb-favorites')!);
		expect(stored).toHaveLength(1);
		expect(stored[0].id).toBe(3570);
	});
});
