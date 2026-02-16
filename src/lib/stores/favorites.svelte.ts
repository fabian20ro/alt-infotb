import type { Station } from '$lib/stations/types.js';

const STORAGE_KEY = 'alt-stb-favorites';
const PINNED_KEY = 'alt-stb-pinned';

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

function loadPinnedId(): number | null {
	try {
		const raw = localStorage.getItem(PINNED_KEY);
		if (!raw) return null;
		const id = JSON.parse(raw);
		return typeof id === 'number' ? id : null;
	} catch {
		return null;
	}
}

function persistPinnedId(id: number | null): void {
	try {
		if (id === null) {
			localStorage.removeItem(PINNED_KEY);
		} else {
			localStorage.setItem(PINNED_KEY, JSON.stringify(id));
		}
	} catch {
		// Silently fail
	}
}

export function createFavoritesStore() {
	let favorites = $state<Station[]>(loadFavorites());
	let pinnedId = $state<number | null>(loadPinnedId());

	function add(station: Station) {
		if (favorites.some((f) => f.id === station.id)) return;
		favorites = [...favorites, station];
		persistFavorites(favorites);
	}

	function remove(stationId: number) {
		favorites = favorites.filter((f) => f.id !== stationId);
		persistFavorites(favorites);
		if (pinnedId === stationId) {
			pinnedId = null;
			persistPinnedId(null);
		}
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

	function togglePin(id: number) {
		const newPinned = pinnedId === id ? null : id;
		pinnedId = newPinned;
		persistPinnedId(newPinned);
	}

	return {
		get favorites() { return favorites; },
		get pinnedId() { return pinnedId; },
		get pinnedStation(): Station | null {
			if (pinnedId === null) return null;
			return favorites.find((f) => f.id === pinnedId) ?? null;
		},
		add,
		remove,
		isFavorite,
		toggle,
		togglePin
	};
}
