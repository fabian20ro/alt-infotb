import type { Station } from '$lib/stations/types.js';

const STORAGE_KEY = 'alt-stb-recents';
const MAX_RECENTS = 5;

function isValidStation(s: unknown): s is Station {
	return !!s && typeof (s as Station).id === 'number' && Number.isFinite((s as Station).id);
}

function loadRecents(): Station[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		return JSON.parse(raw).filter(isValidStation);
	} catch {
		return [];
	}
}

type PersistErrorCallback = (error: unknown) => void;

function persistRecents(recents: Station[], onError?: PersistErrorCallback): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
	} catch (err) {
		if (onError) onError(err);
	}
}

export function createRecentsStore(persistError?: PersistErrorCallback) {
	let recents = $state<Station[]>(loadRecents());

	/** Add a station to recents (moves to front if already present) */
	function add(station: Station) {
		if (!isValidStation(station)) return;
		const filtered = recents.filter((r) => r.id !== station.id);
		recents = [station, ...filtered].slice(0, MAX_RECENTS);
		persistRecents(recents, persistError);
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
