import { fetchArrivals } from '$lib/api/arrivals.js';
import { AUTO_REFRESH_INTERVAL } from '$lib/api/constants.js';
import type { ArrivalsState, StationArrivals } from '$lib/api/types.js';

/** Reactive arrivals state using Svelte 5 runes - used in components via $state */
export function createArrivalsStore() {
	let state = $state<ArrivalsState>({
		status: 'idle',
		data: null,
		error: null
	});

	let autoRefreshEnabled = $state(false);
	let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

	/** Cached station ID from previous successful fetch */
	function getCachedStationId(): string | undefined {
		try {
			return localStorage.getItem('better-stb-station-id') ?? undefined;
		} catch {
			return undefined;
		}
	}

	async function refresh() {
		state.status = 'loading';
		state.error = null;

		try {
			const stationId = getCachedStationId();
			const data = await fetchArrivals(stationId);
			state.data = data;
			state.status = 'success';
		} catch (err) {
			state.error = err instanceof Error ? err.message : 'Eroare necunoscută';
			state.status = 'error';
		}
	}

	function startAutoRefresh() {
		stopAutoRefresh();
		autoRefreshEnabled = true;
		autoRefreshTimer = setInterval(() => {
			if (!document.hidden) {
				refresh();
			}
		}, AUTO_REFRESH_INTERVAL);
	}

	function stopAutoRefresh() {
		autoRefreshEnabled = false;
		if (autoRefreshTimer) {
			clearInterval(autoRefreshTimer);
			autoRefreshTimer = null;
		}
	}

	function toggleAutoRefresh() {
		if (autoRefreshEnabled) {
			stopAutoRefresh();
		} else {
			startAutoRefresh();
		}
	}

	function cleanup() {
		stopAutoRefresh();
	}

	return {
		get state() {
			return state;
		},
		get autoRefreshEnabled() {
			return autoRefreshEnabled;
		},
		refresh,
		toggleAutoRefresh,
		cleanup
	};
}

/** Format seconds to a human-readable arrival time */
export function formatArrivalTime(seconds: number): string {
	const minutes = Math.ceil(seconds / 60);
	if (minutes < 1) return 'acum';
	return `${minutes} min`;
}

/** Format a Date to HH:MM */
export function formatTime(date: Date): string {
	return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

/** Get cached arrivals from localStorage for offline display */
export function getCachedArrivals(): StationArrivals | null {
	try {
		const raw = localStorage.getItem('better-stb-last-arrivals');
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		parsed.fetchedAt = new Date(parsed.fetchedAt);
		return parsed as StationArrivals;
	} catch {
		return null;
	}
}

/** Save arrivals to localStorage for offline display */
export function cacheArrivals(data: StationArrivals): void {
	try {
		localStorage.setItem('better-stb-last-arrivals', JSON.stringify(data));
	} catch {
		// Silently fail if localStorage is full
	}
}
