import { fetchArrivals, fetchLineRoute } from '$lib/api/arrivals.js';
import { ARRIVALS_REFRESH_INTERVAL, STOP_ID } from '$lib/api/constants.js';
import type {
	ArrivalInfo,
	ArrivalsState,
	LineSelectionRequest,
	StationArrivals
} from '$lib/api/types.js';
import { findNearestStations } from '$lib/stations/geo.js';
import { resolveStopIds } from '$lib/stations/subway-stops.js';
import type { Station } from '$lib/stations/types.js';

const HIDDEN_GRACE_PERIOD_MS = 60_000;
const RESUME_DEBOUNCE_MS = 250;
const OPPOSITE_STOP_CANDIDATE_COUNT = 8;

export type SelectedRouteStatus =
	| 'loading'
	| 'ready'
	| 'partial'
	| 'empty'
	| 'error';

export interface SelectedRouteState {
	key: string;
	lineName: string;
	direction: string;
	status: SelectedRouteStatus;
	selection: LineSelectionRequest;
	primary: ArrivalInfo | null;
	opposite: ArrivalInfo | null;
	primaryAvailable: boolean;
	oppositeAvailable: boolean;
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
	let stationCatalog: readonly Station[] = [];
	let failedOppositeDiscoveryKey: string | null = null;
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

	function geometryOnly(arrival: ArrivalInfo | null): ArrivalInfo | null {
		return arrival ? { ...arrival, vehicles: [] } : null;
	}

	function findSelectedLine(
		data: StationArrivals,
		selection: LineSelectionRequest
	): ArrivalInfo | null {
		return data.arrivals.find((arrival) =>
			arrival.lineId === selection.lineId &&
			arrival.directionId === selection.directionId &&
			arrival.sourceStopId === selection.sourceStopId
		) ?? null;
	}

	function isUsableDirection(arrival: ArrivalInfo | null): boolean {
		return arrival !== null && arrival.path.length >= 2;
	}

	function routeError(
		result: PromiseSettledResult<unknown>,
		arrival: ArrivalInfo | null,
		unavailableMessage: string
	): string | null {
		if (result.status === 'rejected') return normalizeError(result.reason);
		return isUsableDirection(arrival) ? null : unavailableMessage;
	}

	function selectedRouteStatus(
		primaryAvailable: boolean,
		oppositeAvailable: boolean,
		vehicleCount: number
	): SelectedRouteStatus {
		if (!primaryAvailable && !oppositeAvailable) return 'error';
		if (!primaryAvailable || !oppositeAvailable) return 'partial';
		return vehicleCount === 0 ? 'empty' : 'ready';
	}

	async function fetchOppositeRoute(
		oppositeSelection: LineSelectionRequest,
		primarySelection: LineSelectionRequest,
		primaryRequest: Promise<StationArrivals>
	): Promise<ArrivalInfo | null> {
		const sameStop = await fetchLineRoute(oppositeSelection);
		if (isUsableDirection(sameStop)) return sameStop;

		const primaryData = await primaryRequest;
		let currentStationRoute = sameStop;
		const currentStationOpposite = primaryData.arrivals.find((arrival) =>
			arrival.lineId === oppositeSelection.lineId &&
			arrival.directionId === oppositeSelection.directionId
		) ?? null;
		if (currentStationOpposite) {
			currentStationRoute = await fetchLineRoute({
				...oppositeSelection,
				sourceStopId: currentStationOpposite.sourceStopId
			});
			if (isUsableDirection(currentStationRoute)) return currentStationRoute;
		}

		const primary = findSelectedLine(primaryData, primarySelection);
		const discoveryKey = `${primarySelection.sourceStopId}|${primarySelection.lineId}|${oppositeSelection.directionId}`;
		if (
			!primary ||
			primary.path.length < 2 ||
			stationCatalog.length === 0 ||
			failedOppositeDiscoveryKey === discoveryKey
		) return currentStationRoute;

		const routeEnd = primary.path[primary.path.length - 1];
		const candidateStopIds = findNearestStations(
			routeEnd.lat,
			routeEnd.lng,
			stationCatalog,
			OPPOSITE_STOP_CANDIDATE_COUNT
		)
			.map((station) => station.id)
			.filter((stopId) => stopId !== primarySelection.sourceStopId);
		if (candidateStopIds.length === 0) return currentStationRoute;

		const terminalData = await fetchArrivals(candidateStopIds);
		const terminalOpposite = terminalData.arrivals.find((arrival) =>
			arrival.lineId === oppositeSelection.lineId &&
			arrival.directionId === oppositeSelection.directionId
		) ?? null;
		if (!terminalOpposite) {
			failedOppositeDiscoveryKey = discoveryKey;
			return currentStationRoute;
		}
		const discoveredOpposite = await fetchLineRoute({
			...oppositeSelection,
			sourceStopId: terminalOpposite.sourceStopId
		});
		if (!isUsableDirection(discoveredOpposite)) failedOppositeDiscoveryKey = discoveryKey;
		return discoveredOpposite;
	}

	async function executeRefresh(): Promise<boolean> {
		const requestVersion = selectionVersion;
		const requestStopIds = [...currentStopIds];
		const requestLineSelection = lineSelection ? { ...lineSelection } : undefined;
		state.status = 'loading';
		state.error = null;

		if (!requestLineSelection) {
			try {
				const data = await fetchArrivals(requestStopIds);
				if (requestVersion !== selectionVersion) return false;
				state.data = data;
				state.status = 'success';
				return true;
			} catch (err) {
				if (requestVersion !== selectionVersion) return false;
				state.error = normalizeError(err);
				state.status = 'error';
				return false;
			}
		}

		const selectedRoute = routeState;
		if (!selectedRoute) return false;
		const oppositeSelection: LineSelectionRequest = {
			...requestLineSelection,
			sourceStopId: selectedRoute.opposite?.sourceStopId ?? requestLineSelection.sourceStopId,
			directionId: requestLineSelection.directionId === 0 ? 1 : 0
		};
		const primaryRequest = fetchArrivals(requestStopIds, requestLineSelection);
		const oppositeRequest = fetchOppositeRoute(
			oppositeSelection,
			requestLineSelection,
			primaryRequest
		);
		const [primaryResult, oppositeResult] = await Promise.allSettled([
			primaryRequest,
			oppositeRequest
		]);

		// Publish both directions as one snapshot; stale pairs never partially update state.
		if (requestVersion !== selectionVersion) return false;
		const currentRoute = routeState;
		if (!currentRoute) return false;

		const previousPrimary = geometryOnly(currentRoute.primary);
		const previousOpposite = geometryOnly(currentRoute.opposite);
		const primary = primaryResult.status === 'fulfilled'
			? findSelectedLine(primaryResult.value, requestLineSelection)
			: null;
		const opposite = oppositeResult.status === 'fulfilled' ? oppositeResult.value : null;
		const primaryUsable = isUsableDirection(primary);
		const oppositeUsable = isUsableDirection(opposite);
		const primaryError = routeError(primaryResult, primary, 'Route unavailable');
		const oppositeError = routeError(oppositeResult, opposite, 'Opposite route unavailable');

		if (primaryResult.status === 'fulfilled') {
			state.data = primaryResult.value;
			state.status = 'success';
			state.error = null;
		} else {
			state.status = 'error';
			state.error = normalizeError(primaryResult.reason);
		}

		const nextPrimary = primaryUsable ? primary : previousPrimary;
		const nextOpposite = oppositeUsable ? opposite : previousOpposite;
		const vehicleCount = (nextPrimary?.vehicles.length ?? 0) + (nextOpposite?.vehicles.length ?? 0);
		const status = selectedRouteStatus(primaryUsable, oppositeUsable, vehicleCount);
		const errors = [primaryError, oppositeError].filter((error): error is string => error !== null);

		routeState = {
			...currentRoute,
			lineName: primary?.lineName ?? currentRoute.lineName,
			direction: primary?.direction ?? currentRoute.direction,
			status,
			primary: nextPrimary,
			opposite: nextOpposite,
			primaryAvailable: primaryUsable,
			oppositeAvailable: oppositeUsable,
			error: errors.length > 0 ? errors.join('; ') : null
		};
		return primaryResult.status === 'fulfilled';
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
		failedOppositeDiscoveryKey = null;
		currentStopIds = resolveStopIds(stopId);
		lineSelection = null;
		routeState = null;
		state.data = null;
		state.error = null;
		startPolling();
		void refresh();
	}

	function setStations(stations: readonly Station[]) {
		stationCatalog = stations;
		failedOppositeDiscoveryKey = null;
		if (lineSelection && routeState && !routeState.oppositeAvailable) void refresh();
	}

	function selectLine(arrival: ArrivalInfo) {
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
		failedOppositeDiscoveryKey = null;
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
			primary: null,
			opposite: null,
			primaryAvailable: false,
			oppositeAvailable: false,
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
		failedOppositeDiscoveryKey = null;
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
		setStations,
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
