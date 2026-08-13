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



export function createFavoritesStore() {
	let favorites = $state<Station[]>(loadFavorites());
	let pinnedId = $state<number | null>(loadPinnedId());

	function persist(key: string, value: unknown): void {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// Silently fail — state already updated
		}
	}

	function removeItemSafely(key: string): void {
		try {
			localStorage.removeItem(key);
		} catch {
			// Silently fail
		}
	}

	function isValidStation(station: unknown): station is Station {
		return (
			station !== null &&
			typeof station === 'object' &&
			Number.isInteger((station as Station).id) &&
			typeof (station as Station).name === 'string' &&
			typeof (station as Station).lat === 'number' &&
			typeof (station as Station).lon === 'number'
		);
	}

	function add(station: unknown) {
		if (!isValidStation(station)) return;
		const stationId = station.id;
		if (favorites.some((f) => f.id === stationId)) return;
		favorites = [...favorites, station];
		persist(STORAGE_KEY, favorites);
	}

	function remove(stationId: number) {
		favorites = favorites.filter((f) => f.id !== stationId);
		persist(STORAGE_KEY, favorites);
		if (pinnedId === stationId) {
			pinnedId = null;
			removeItemSafely(PINNED_KEY);
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
		if (pinnedId === id) {
			pinnedId = null;
			removeItemSafely(PINNED_KEY);
			return;
		}

		// Only pin stations that exist in favorites
		const station = favorites.find((f) => f.id === id);
		if (!station) return;

		pinnedId = id;
		persist(PINNED_KEY, id);
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
