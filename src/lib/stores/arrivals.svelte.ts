import { fetchArrivals } from '$lib/api/arrivals.js';
import { ARRIVALS_REFRESH_INTERVAL, STOP_ID } from '$lib/api/constants.js';
import type { ArrivalsState, StationArrivals } from '$lib/api/types.js';
import { resolveStopIds } from '$lib/stations/subway-stops.js';

const HIDDEN_GRACE_PERIOD_MS = 60_000;
const RESUME_DEBOUNCE_MS = 250;

/** Reactive arrivals state using Svelte 5 runes */
export function createArrivalsStore() {
	let state = $state<ArrivalsState>({
		status: 'idle',
		data: null,
		error: null
	});

	let currentStopIds = $state<number[]>([STOP_ID]);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let hiddenPauseTimer: ReturnType<typeof setTimeout> | null = null;
	let pollingEnabled = false;
	let pausedByHiddenTimeout = false;
	let inFlightRefresh: Promise<boolean> | null = null;
	let refreshQueued = false;
	let selectionVersion = 0;
	let lastVisibleSignalAt = 0;

	function clearPollTimer() {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	function clearHiddenPauseTimer() {
		if (hiddenPauseTimer) {
			clearTimeout(hiddenPauseTimer);
			hiddenPauseTimer = null;
		}
	}

	function scheduleNextPoll() {
		clearPollTimer();
		if (!pollingEnabled || pausedByHiddenTimeout) return;
		pollTimer = setTimeout(() => {
			void refresh();
		}, ARRIVALS_REFRESH_INTERVAL);
	}

	function startPolling() {
		pollingEnabled = true;
		scheduleNextPoll();
	}

	function normalizeError(err: unknown): string {
		return err instanceof Error ? err.message : 'Eroare necunoscută';
	}

	async function executeRefresh(): Promise<boolean> {
		const requestVersion = selectionVersion;
		const requestStopIds = [...currentStopIds];
		state.status = 'loading';
		state.error = null;

		try {
			const data = await fetchArrivals(requestStopIds);
			if (requestVersion !== selectionVersion) return false;
			state.data = data;
			state.status = 'success';
			state.error = null;
			return true;
		} catch (err) {
			if (requestVersion !== selectionVersion) return false;
			state.error = normalizeError(err);
			state.status = 'error';
			return false;
		}
	}

	async function refresh(): Promise<boolean> {
		if (inFlightRefresh) {
			refreshQueued = true;
			return inFlightRefresh;
		}

		inFlightRefresh = executeRefresh();
		let result = false;
		try {
			result = await inFlightRefresh;
		} finally {
			inFlightRefresh = null;
		}

		if (refreshQueued) {
			refreshQueued = false;
			void refresh();
		} else {
			scheduleNextPoll();
		}

		return result;
	}

	function selectStation(stopId: number) {
		selectionVersion += 1;
		currentStopIds = resolveStopIds(stopId);
		state.data = null;
		state.error = null;
		startPolling();
		void refresh();
	}

	function onHidden() {
		clearHiddenPauseTimer();
		hiddenPauseTimer = setTimeout(() => {
			pausedByHiddenTimeout = true;
			clearPollTimer();
		}, HIDDEN_GRACE_PERIOD_MS);
	}

	function onVisible() {
		const now = Date.now();
		if (now - lastVisibleSignalAt < RESUME_DEBOUNCE_MS) return;
		lastVisibleSignalAt = now;

		clearHiddenPauseTimer();
		pausedByHiddenTimeout = false;

		if (!pollingEnabled) return;
		scheduleNextPoll();
		void refresh();
	}

	function cleanup() {
		selectionVersion += 1;
		pollingEnabled = false;
		pausedByHiddenTimeout = false;
		refreshQueued = false;
		clearPollTimer();
		clearHiddenPauseTimer();
	}

	return {
		get state() {
			return state;
		},
		get currentStopId() {
			return currentStopIds[0];
		},
		refresh,
		selectStation,
		onHidden,
		onVisible,
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

		// Validate structure before returning — prevents display crashes on corrupted cache
		if (
			!parsed ||
			typeof parsed.stationName !== 'string' ||
			typeof parsed.address !== 'string' ||
			!Array.isArray(parsed.arrivals) ||
			!(parsed.fetchedAt instanceof Date)
		) {
			return null;
		}

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
