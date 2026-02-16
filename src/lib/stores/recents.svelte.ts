import type { Station } from '$lib/stations/types.js';

const STORAGE_KEY = 'alt-stb-recents';
const MAX_RECENTS = 5;

function loadRecents(): Station[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		return JSON.parse(raw) as Station[];
	} catch {
		return [];
	}
}

function persistRecents(recents: Station[]): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
	} catch {
		// Silently fail
	}
}

export function createRecentsStore() {
	let recents = $state<Station[]>(loadRecents());

	/** Add a station to recents (moves to front if already present) */
	function add(station: Station) {
		const filtered = recents.filter((r) => r.id !== station.id);
		recents = [station, ...filtered].slice(0, MAX_RECENTS);
		persistRecents(recents);
	}

	/** Get recents excluding stations that are in favorites */
	function getExcluding(favoriteIds: Set<number>): Station[] {
		return recents.filter((r) => !favoriteIds.has(r.id));
	}

	return {
		get recents() { return recents; },
		add,
		getExcluding
	};
}
