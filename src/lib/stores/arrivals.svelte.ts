import { fetchArrivals, fetchLineRoute } from '$lib/api/arrivals.js';
import { ARRIVALS_REFRESH_INTERVAL, STOP_ID } from '$lib/api/constants.js';
import type {
	ArrivalInfo,
	ArrivalsState,
	LineSelectionRequest,
	RoutePoint,
	StationArrivals
} from '$lib/api/types.js';
import {
	classifyOppositeTurnaroundVehicles,
	classifySameDirectionVehicles,
	isPointNearRouteOrigin
} from '$lib/route-map/vehicle-selection.js';
import { resolveStopIds } from '$lib/stations/subway-stops.js';

const HIDDEN_GRACE_PERIOD_MS = 60_000;
const RESUME_DEBOUNCE_MS = 250;

export type SelectedRouteStatus =
	| 'loading'
	| 'ready'
	| 'checking-opposite'
	| 'fallback'
	| 'empty'
	| 'positions-error'
	| 'error';

export interface SelectedRouteState {
	key: string;
	lineName: string;
	direction: string;
	status: SelectedRouteStatus;
	selection: LineSelectionRequest;
	stationPoint: RoutePoint;
	primary: ArrivalInfo | null;
	opposite: ArrivalInfo | null;
	approachingVehicleIds: number[];
	turnaroundVehicleIds: number[];
	error: string | null;
}

export function getArrivalSelectionKey(arrival: ArrivalInfo): string {
	return `${arrival.lineId}|${arrival.vehicleType}|${arrival.directionId}|${arrival.sourceStopId}`;
}

/** Reactive arrivals state using Svelte 5 runes */
export function createArrivalsStore() {
	let state = $state<ArrivalsState>({
		status: 'idle',
		data: null,
		error: null
	});

	let currentStopIds = $state<number[]>([STOP_ID]);
	let lineSelection = $state<LineSelectionRequest | null>(null);
	let routeState = $state<SelectedRouteState | null>(null);
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
		const requestLineSelection = lineSelection ? { ...lineSelection } : undefined;
		state.status = 'loading';
		state.error = null;

		try {
			const data = await fetchArrivals(requestStopIds, requestLineSelection);
			if (requestVersion !== selectionVersion) return false;
			state.data = data;
			state.status = 'success';
			state.error = null;
			if (requestLineSelection) {
				const primary = data.arrivals.find((arrival) =>
					arrival.lineId === requestLineSelection.lineId &&
					arrival.directionId === requestLineSelection.directionId &&
					arrival.sourceStopId === requestLineSelection.sourceStopId
				) ?? null;
				await updateSelectedRoute(primary, requestLineSelection, requestVersion);
			}
			return true;
		} catch (err) {
			if (requestVersion !== selectionVersion) return false;
			const error = normalizeError(err);
			state.error = error;
			state.status = 'error';
			if (requestLineSelection && routeState?.status === 'loading') {
				routeState = {
					...routeState,
					status: 'error',
					error
				};
			}
			return false;
		}
	}

	async function updateSelectedRoute(
		primary: ArrivalInfo | null,
		selection: LineSelectionRequest,
		requestVersion: number
	) {
		if (!routeState || requestVersion !== selectionVersion || !lineSelection) return;
		if (!primary || primary.path.length < 2) {
			routeState = {
				...routeState,
				status: 'error',
				primary,
				opposite: null,
				approachingVehicleIds: [],
				turnaroundVehicleIds: [],
				error: 'Route unavailable'
			};
			return;
		}

		const sameDirection = classifySameDirectionVehicles(
			primary.path,
			routeState.stationPoint,
			primary.vehicles
		);
		const approachingVehicleIds = sameDirection.approaching.map(({ vehicle }) => vehicle.id);
		routeState = {
			...routeState,
			lineName: primary.lineName,
			direction: primary.direction,
			status: approachingVehicleIds.length > 0 || !sameDirection.isConclusive
				? 'ready'
				: 'checking-opposite',
			primary,
			opposite: null,
			approachingVehicleIds,
			turnaroundVehicleIds: [],
			error: null
		};

		// Ambiguous route projection: show all vehicles, but do not make a directional claim.
		if (!sameDirection.isConclusive || approachingVehicleIds.length > 0) return;

		const oppositeSelection: LineSelectionRequest = {
			...selection,
			directionId: selection.directionId === 0 ? 1 : 0
		};
		try {
			const opposite = await fetchLineRoute(oppositeSelection);
			if (requestVersion !== selectionVersion || !routeState || !lineSelection) return;
			if (!opposite || opposite.vehicles.length === 0) {
				routeState = {
					...routeState,
					status: primary.vehicles.length === 0 ? 'empty' : 'ready',
					opposite,
					turnaroundVehicleIds: []
				};
				return;
			}

			const nearOrigin = isPointNearRouteOrigin(routeState.stationPoint, primary.path);
			const oppositeClassification = nearOrigin
				? classifyOppositeTurnaroundVehicles(opposite.path, opposite.vehicles)
				: null;
			const turnaroundVehicleIds = oppositeClassification?.isConclusive
				? oppositeClassification.candidates.map(({ vehicle }) => vehicle.id)
				: [];
			routeState = {
				...routeState,
				status: 'fallback',
				opposite,
				turnaroundVehicleIds
			};
		} catch (err) {
			if (requestVersion !== selectionVersion || !routeState) return;
			routeState = {
				...routeState,
				status: 'positions-error',
				error: normalizeError(err)
			};
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
		lineSelection = null;
		routeState = null;
		state.data = null;
		state.error = null;
		startPolling();
		void refresh();
	}

	function selectLine(arrival: ArrivalInfo, stationPoint: RoutePoint) {
		const key = getArrivalSelectionKey(arrival);
		if (routeState?.key === key) {
			clearLine();
			return;
		}
		if (
			!Number.isInteger(arrival.sourceStopId) || arrival.sourceStopId <= 0 ||
			!Number.isInteger(arrival.lineId) || arrival.lineId <= 0 ||
			(arrival.directionId !== 0 && arrival.directionId !== 1)
		) {
			void refresh();
			return;
		}
		selectionVersion += 1;
		lineSelection = {
			sourceStopId: arrival.sourceStopId,
			lineId: arrival.lineId,
			directionId: arrival.directionId
		};
		routeState = {
			key,
			lineName: arrival.lineName,
			direction: arrival.direction,
			status: 'loading',
			selection: { ...lineSelection },
			stationPoint: { ...stationPoint },
			primary: null,
			opposite: null,
			approachingVehicleIds: [],
			turnaroundVehicleIds: [],
			error: null
		};
		startPolling();
		void refresh();
	}

	function clearLine() {
		if (!lineSelection && !routeState) return;
		selectionVersion += 1;
		lineSelection = null;
		routeState = null;
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
		lineSelection = null;
		routeState = null;
	}

	return {
		get state() {
			return state;
		},
		get currentStopId() {
			return currentStopIds[0];
		},
		get route() {
			return routeState;
		},
		refresh,
		selectStation,
		selectLine,
		clearLine,
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
		const cacheSafeData: StationArrivals = {
			...data,
			arrivals: data.arrivals.map((arrival) => ({
				...arrival,
				encodedPath: '',
				path: [],
				vehicles: []
			}))
		};
		localStorage.setItem('alt-stb-last-arrivals', JSON.stringify(cacheSafeData));
	} catch {
		// Silently fail if localStorage is full
	}
}
