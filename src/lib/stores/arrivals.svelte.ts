import { fetchArrivals } from '$lib/api/arrivals.js';
import { AUTO_REFRESH_INTERVAL, STOP_ID } from '$lib/api/constants.js';
import type { ArrivalsState, StationArrivals } from '$lib/api/types.js';
import { resolveStopIds } from '$lib/stations/subway-stops.js';

/** Reactive arrivals state using Svelte 5 runes */
export function createArrivalsStore() {
	let state = $state<ArrivalsState>({
		status: 'idle',
		data: null,
		error: null
	});

	let currentStopIds = $state<number[]>([STOP_ID]);
	let autoRefreshEnabled = $state(false);
	let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

	async function refresh() {
		state.status = 'loading';
		state.error = null;

		try {
			const data = await fetchArrivals(currentStopIds);
			state.data = data;
			state.status = 'success';
		} catch (err) {
			state.error = err instanceof Error ? err.message : 'Eroare necunoscută';
			state.status = 'error';
		}
	}

	function selectStation(stopId: number) {
		currentStopIds = resolveStopIds(stopId);
		state.data = null;
		refresh();
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
		get currentStopId() {
			return currentStopIds[0];
		},
		get autoRefreshEnabled() {
			return autoRefreshEnabled;
		},
		refresh,
		selectStation,
		toggleAutoRefresh,
		cleanup
	};
}

/** Format seconds to a human-readable arrival time */
export function formatArrivalTime(seconds: number): string {
	if (seconds < 30) return 'acum';
	const totalMinutes = Math.ceil(seconds / 60);
	if (totalMinutes <= 59) return `${totalMinutes} min`;
	const hours = Math.floor(totalMinutes / 60);
	const mins = totalMinutes % 60;
	const hourWord = hours === 1 ? 'oră' : 'ore';
	if (mins === 0) return `${hours} ${hourWord}`;
	return `${hours} ${hourWord}, ${mins} min`;
}

/** Format a Date to HH:MM */
export function formatTime(date: Date): string {
	return date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

/** Get cached arrivals from localStorage for offline display */
export function getCachedArrivals(): StationArrivals | null {
	try {
		const raw = localStorage.getItem('alt-stb-last-arrivals');
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
		localStorage.setItem('alt-stb-last-arrivals', JSON.stringify(data));
	} catch {
		// Silently fail if localStorage is full
	}
}
