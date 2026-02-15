import type { Station } from '$lib/stations/types.js';

const STORAGE_KEY = 'better-stb-favorites';

function loadFavorites(): Station[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		return JSON.parse(raw) as Station[];
	} catch {
		return [];
	}
}

function persistFavorites(favs: Station[]): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(favs));
	} catch {
		// Silently fail
	}
}

export function createFavoritesStore() {
	let favorites = $state<Station[]>(loadFavorites());

	function add(station: Station) {
		if (favorites.some((f) => f.id === station.id)) return;
		favorites = [...favorites, station];
		persistFavorites(favorites);
	}

	function remove(stationId: number) {
		favorites = favorites.filter((f) => f.id !== stationId);
		persistFavorites(favorites);
	}

	function isFavorite(stationId: number): boolean {
		return favorites.some((f) => f.id === stationId);
	}

	function toggle(station: Station) {
		if (isFavorite(station.id)) {
			remove(station.id);
		} else {
			add(station);
		}
	}

	return {
		get favorites() { return favorites; },
		add,
		remove,
		isFavorite,
		toggle
	};
}
