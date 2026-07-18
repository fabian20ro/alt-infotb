import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArrivalInfo, StationArrivals } from '$lib/api/types.js';
import { formatArrivalTime, formatTime } from './arrivals.svelte.js';

const fetchArrivalsMock = vi.hoisted(() => vi.fn());
const fetchLineRouteMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/arrivals.js', () => ({
	fetchArrivals: fetchArrivalsMock,
	fetchLineRoute: fetchLineRouteMock
}));

function makeArrivals(stationName: string): StationArrivals {
	return {
		stationName,
		address: 'Bucharest',
		arrivals: [],
		fetchedAt: new Date('2026-02-26T00:00:00.000Z')
	};
}

function makeLine(overrides: Partial<ArrivalInfo> = {}): ArrivalInfo {
	return {
		lineName: 'N101',
		lineId: 208,
		vehicleType: 'BUS',
		color: '#006b3c',
		direction: 'Valea Oltului',
		directionId: 0,
		sourceStopId: 6886,
		arrivingTimes: [300],
		encodedPath: 'test-path',
		path: [
			{ lat: 44.42, lng: 26.1 },
			{ lat: 44.42, lng: 26.13 }
		],
		vehicles: [],
		...overrides
	};
}

function makeArrivalsWithLine(line: ArrivalInfo): StationArrivals {
	return {
		...makeArrivals('Piata Unirii 2'),
		arrivals: [line]
	};
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

async function createStore() {
	vi.resetModules();
	const { createArrivalsStore } = await import('./arrivals.svelte.js');
	return createArrivalsStore();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-02-26T10:00:00.000Z'));
	fetchArrivalsMock.mockReset();
	fetchLineRouteMock.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('formatArrivalTime', () => {
	it('returns "acum" for 0 seconds', () => {
		expect(formatArrivalTime(0)).toBe('acum');
	});

	it('returns "acum" for negative seconds', () => {
		expect(formatArrivalTime(-5)).toBe('acum');
	});

	it('returns "acum" for values under 30 seconds', () => {
		expect(formatArrivalTime(1)).toBe('acum');
		expect(formatArrivalTime(15)).toBe('acum');
		expect(formatArrivalTime(29)).toBe('acum');
	});

	it('returns "1 min" for 30-60 seconds', () => {
		expect(formatArrivalTime(30)).toBe('1 min');
		expect(formatArrivalTime(60)).toBe('1 min');
	});

	it('rounds up to nearest minute', () => {
		expect(formatArrivalTime(61)).toBe('2 min');
		expect(formatArrivalTime(90)).toBe('2 min');
		expect(formatArrivalTime(120)).toBe('2 min');
	});

	it('formats minutes up to 59', () => {
		expect(formatArrivalTime(3540)).toBe('59 min');
	});

	it('formats exactly 1 hour', () => {
		expect(formatArrivalTime(3600)).toBe('1 oră');
	});

	it('formats 1 hour with minutes using singular "oră"', () => {
		expect(formatArrivalTime(3660)).toBe('1 oră, 1 min');
		expect(formatArrivalTime(6000)).toBe('1 oră, 40 min');
	});

	it('formats 2+ hours with minutes using plural "ore"', () => {
		expect(formatArrivalTime(7200)).toBe('2 ore');
		expect(formatArrivalTime(7260)).toBe('2 ore, 1 min');
		expect(formatArrivalTime(8100)).toBe('2 ore, 15 min');
	});

	it('handles real-world values from proto dump', () => {
		// From actual STB API: line 7 → C.F.R. Progresul
		expect(formatArrivalTime(120)).toBe('2 min');
		expect(formatArrivalTime(1080)).toBe('18 min');
		expect(formatArrivalTime(1680)).toBe('28 min');

		// From actual STB API: line 27 → Faur
		expect(formatArrivalTime(480)).toBe('8 min');
		expect(formatArrivalTime(1560)).toBe('26 min');
		expect(formatArrivalTime(2280)).toBe('38 min');
	});
});

describe('formatTime', () => {
	it('formats date to HH:MM', () => {
		const date = new Date('2025-01-15T14:30:00');
		const result = formatTime(date);
		expect(result).toMatch(/14[:\\.]30/);
	});
});

describe('createArrivalsStore lifecycle polling', () => {
	it('polls every 20 seconds after selecting a station', async () => {
		const initial = createDeferred<StationArrivals>();
		fetchArrivalsMock.mockImplementationOnce(() => initial.promise);

		const store = await createStore();

		expect(store.state.status).toBe('idle');
		expect(store.state.data).toBeNull();

		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);
		expect(store.state.status).toBe('loading');
		expect(store.state.error).toBeNull();
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		initial.resolve(makeArrivals('A'));
		await vi.advanceTimersByTimeAsync(0);
		expect(store.state.data?.stationName).toBe('A');
		expect(store.state.status).toBe('success');
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(2);

		store.cleanup();
	});

	it('pauses after 1 minute hidden and resumes immediately on visible', async () => {
		fetchArrivalsMock.mockResolvedValue(makeArrivals('A'));
		const store = await createStore();

		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);
		store.onHidden();

		await vi.advanceTimersByTimeAsync(61_000);
		const pausedCount = fetchArrivalsMock.mock.calls.length;

		await vi.advanceTimersByTimeAsync(40_000);
		expect(fetchArrivalsMock.mock.calls.length).toBe(pausedCount);

		store.onVisible();
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchArrivalsMock.mock.calls.length).toBe(pausedCount + 1);

		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetchArrivalsMock.mock.calls.length).toBe(pausedCount + 2);

		store.cleanup();
	});

	it('ignores stale response when station changes during an in-flight request', async () => {
		const first = createDeferred<StationArrivals>();
		const second = createDeferred<StationArrivals>();

		fetchArrivalsMock
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);

		const store = await createStore();
		store.selectStation(1001);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		store.selectStation(2002);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		first.resolve(makeArrivals('Old station'));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(2);
		expect(fetchArrivalsMock.mock.calls[1][0]).toEqual([2002]);
		expect(store.state.data).toBeNull();

		second.resolve(makeArrivals('New station'));
		await vi.advanceTimersByTimeAsync(0);
		expect(store.state.data?.stationName).toBe('New station');

		store.cleanup();
	});

	it('debounces duplicate visible signals (focus + visibilitychange)', async () => {
		const resumeFetch = createDeferred<StationArrivals>();
		fetchArrivalsMock
			.mockResolvedValueOnce(makeArrivals('A'))
			.mockImplementationOnce(() => resumeFetch.promise)
			.mockResolvedValue(makeArrivals('A'));

		const store = await createStore();
		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);

		store.onVisible();
		store.onVisible();
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(2);

		resumeFetch.resolve(makeArrivals('A'));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(3);

		store.cleanup();
	});

	it('queues one trailing refresh when resume happens during an in-flight request', async () => {
		const initial = createDeferred<StationArrivals>();
		fetchArrivalsMock
			.mockImplementationOnce(() => initial.promise)
			.mockResolvedValue(makeArrivals('A'));

		const store = await createStore();
		store.selectStation(3570);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		store.onVisible();
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		initial.resolve(makeArrivals('A'));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(2);

		store.cleanup();
	});

	it('sets status=error and a normalized message when fetch fails', async () => {
		fetchArrivalsMock.mockRejectedValue(new Error('STB este indisponibil'));

		const store = await createStore();
		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);

		expect(store.state.status).toBe('error');
		expect(store.state.error).toBe('STB este indisponibil');
		expect(store.state.data).toBeNull();

		store.cleanup();
	});

	it('continues polling after a fetch error', async () => {
		const firstError = new Error('Network failure');
		fetchArrivalsMock.mockRejectedValueOnce(firstError);
		fetchArrivalsMock.mockResolvedValue(makeArrivals('A'));

		const store = await createStore();
		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);
		expect(store.state.status).toBe('error');
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(2);
		expect(store.state.data?.stationName).toBe('A');

		store.cleanup();
	});

	it('does not pause polling during the onHidden grace period', async () => {
		fetchArrivalsMock.mockResolvedValue(makeArrivals('A'));

		const store = await createStore();
		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		store.onHidden();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(2);

		store.cleanup();
	});

	it('resumes polling immediately when onVisible fires within the hidden grace period', async () => {
		fetchArrivalsMock.mockResolvedValue(makeArrivals('A'));

		const store = await createStore();
		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		// onHidden starts a grace period (60s countdown) — polling still active during this window.
		// onVisible immediately clears the grace timer, re-arms poll, and triggers an immediate refresh.
		store.onHidden();
		const callsBeforeVisible = fetchArrivalsMock.mock.calls.length;

		store.onVisible(); // triggers immediate refresh via scheduleNextPoll() + refresh()
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(callsBeforeVisible + 1);

		store.cleanup();
	});

	it('clears hidden-pause state when cleanup is called during the grace period', async () => {
		fetchArrivalsMock.mockResolvedValue(makeArrivals('A'));

		const store = await createStore();
		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1);

		store.onHidden();
		// advance to 40s — inside the 60s grace period (not yet paused)
		await vi.advanceTimersByTimeAsync(40_000);
		expect(store.state.data?.stationName).toBe('A');

		store.cleanup();

		// after cleanup, polling is disabled; no further calls even if timers fire
		const countAfterCleanup = fetchArrivalsMock.mock.calls.length;

		await vi.advanceTimersByTimeAsync(61_000); // past the original grace timeout + one poll interval
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(countAfterCleanup);
	});

	it('sets normalized error message when fetch throws a non-Error value', async () => {
		fetchArrivalsMock.mockRejectedValue('string error');

		const store = await createStore();
		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);

		expect(store.state.status).toBe('error');
		expect(typeof store.state.error).toBe('string');
		expect(store.state.error).not.toContain('string error'); // normalized, not raw

		store.cleanup();
	});

	it('ignores in-flight fetch result after cleanup', async () => {
		const pending = createDeferred<StationArrivals>();

		fetchArrivalsMock.mockImplementationOnce(() => pending.promise);

		const store = await createStore();
		store.selectStation(3570);
		await vi.advanceTimersByTimeAsync(0);
		expect(store.state.status).toBe('loading');

		store.cleanup();
		pending.resolve(makeArrivals('Late station'));
		await vi.advanceTimersByTimeAsync(0);

		expect(store.state.data).toBeNull();
		expect(store.state.status).not.toBe('success');

		store.cleanup();
	});

	it('resolves only the last request when stations are selected rapidly', async () => {
		const initial = createDeferred<StationArrivals>();
		const queued = createDeferred<StationArrivals>();

		fetchArrivalsMock
			.mockImplementationOnce(() => initial.promise)
			.mockImplementation(() => queued.promise);

		const store = await createStore();
		store.selectStation(1001);
		store.selectStation(2002);
		store.selectStation(3003);

		expect(fetchArrivalsMock).toHaveBeenCalledTimes(1); // only first fires; rest queue via refresh() early-return
		expect(store.state.status).toBe('loading');

		initial.resolve(makeArrivals('Stale'));
		await vi.advanceTimersByTimeAsync(0);

		// stale response discarded by version check, queued refresh runs immediately with current selection (3003)
		expect(fetchArrivalsMock).toHaveBeenCalledTimes(2);
		queued.resolve(makeArrivals('Current')); // resolve the queued call's promise
		await vi.advanceTimersByTimeAsync(100); // give async chain time to complete
		expect(store.state.data?.stationName).toBe('Current'); // queued call's data from current stopId 3003

		store.cleanup();
	});
});

describe('createArrivalsStore selected route', () => {
	it('uses the selected line response as the normal refresh and classifies approaching vehicles', async () => {
		const plainLine = makeLine({ encodedPath: '', path: [], vehicles: [] });
		const selectedLine = makeLine({
			vehicles: [
				{ id: 701, lat: 44.42, lng: 26.105, vehicleType: 'BUS', accessible: true },
				{ id: 702, lat: 44.42, lng: 26.125, vehicleType: 'BUS', accessible: false }
			]
		});
		fetchArrivalsMock
			.mockResolvedValueOnce(makeArrivalsWithLine(plainLine))
			.mockResolvedValueOnce(makeArrivalsWithLine(selectedLine));

		const store = await createStore();
		store.selectStation(6886);
		await vi.advanceTimersByTimeAsync(0);
		store.selectLine(plainLine, { lat: 44.42, lng: 26.115 });
		await vi.advanceTimersByTimeAsync(0);

		expect(fetchArrivalsMock).toHaveBeenLastCalledWith([6886], {
			sourceStopId: 6886,
			lineId: 208,
			directionId: 0
		});
		expect(store.state.data?.arrivals[0].vehicles).toHaveLength(2);
		expect(store.route?.status).toBe('ready');
		expect(store.route?.approachingVehicleIds).toEqual([701]);
		expect(fetchLineRouteMock).not.toHaveBeenCalled();
		store.cleanup();
	});

	it('checks the opposite direction and labels near-origin turnaround candidates', async () => {
		const plainLine = makeLine({ encodedPath: '', path: [], vehicles: [] });
		const selectedLine = makeLine({
			vehicles: [
				{ id: 801, lat: 44.42, lng: 26.12, vehicleType: 'BUS', accessible: false }
			]
		});
		const oppositeLine = makeLine({
			direction: 'Piata Unirii 2',
			directionId: 1,
			path: [...selectedLine.path].reverse(),
			vehicles: [
				{ id: 901, lat: 44.42, lng: 26.102, vehicleType: 'BUS', accessible: true }
			]
		});
		fetchArrivalsMock
			.mockResolvedValueOnce(makeArrivalsWithLine(plainLine))
			.mockResolvedValueOnce(makeArrivalsWithLine(selectedLine));
		fetchLineRouteMock.mockResolvedValueOnce(oppositeLine);

		const store = await createStore();
		store.selectStation(6886);
		await vi.advanceTimersByTimeAsync(0);
		store.selectLine(plainLine, { lat: 44.42, lng: 26.101 });
		await vi.advanceTimersByTimeAsync(0);

		expect(fetchLineRouteMock).toHaveBeenCalledWith({
			sourceStopId: 6886,
			lineId: 208,
			directionId: 1
		});
		expect(store.route?.status).toBe('fallback');
		expect(store.route?.opposite?.directionId).toBe(1);
		expect(store.route?.turnaroundVehicleIds).toEqual([901]);
		store.cleanup();
	});

	it('clears route mode on a second tap and on station change', async () => {
		const line = makeLine({ encodedPath: '', path: [], vehicles: [] });
		fetchArrivalsMock.mockResolvedValue(makeArrivalsWithLine(line));

		const store = await createStore();
		store.selectStation(6886);
		await vi.advanceTimersByTimeAsync(0);
		store.selectLine(line, { lat: 44.42, lng: 26.101 });
		expect(store.route).not.toBeNull();
		store.selectLine(line, { lat: 44.42, lng: 26.101 });
		expect(store.route).toBeNull();

		store.selectLine(line, { lat: 44.42, lng: 26.101 });
		expect(store.route).not.toBeNull();
		store.selectStation(3570);
		expect(store.route).toBeNull();
		store.cleanup();
	});

	it('does not claim an empty opposite direction when that request fails', async () => {
		const line = makeLine({ vehicles: [] });
		fetchArrivalsMock.mockResolvedValue(makeArrivalsWithLine(line));
		fetchLineRouteMock.mockRejectedValue(new Error('opposite unavailable'));

		const store = await createStore();
		store.selectStation(6886);
		await vi.advanceTimersByTimeAsync(0);
		store.selectLine(line, { lat: 44.42, lng: 26.115 });
		await vi.advanceTimersByTimeAsync(0);

		expect(store.route?.status).toBe('positions-error');
		expect(store.route?.error).toContain('opposite unavailable');
		store.cleanup();
	});

	it('ends initial route loading on a selected-line request failure', async () => {
		const line = makeLine({ encodedPath: '', path: [], vehicles: [] });
		fetchArrivalsMock
			.mockResolvedValueOnce(makeArrivalsWithLine(line))
			.mockRejectedValueOnce(new Error('route unavailable'));

		const store = await createStore();
		store.selectStation(6886);
		await vi.advanceTimersByTimeAsync(0);
		store.selectLine(line, { lat: 44.42, lng: 26.115 });
		await vi.advanceTimersByTimeAsync(0);

		expect(store.route?.status).toBe('error');
		expect(store.route?.primary).toBeNull();
		expect(store.route?.error).toContain('route unavailable');
		store.cleanup();
	});

	it('preserves a successful route overlay when a later poll fails', async () => {
		const line = makeLine({
			vehicles: [
				{ id: 701, lat: 44.42, lng: 26.105, vehicleType: 'BUS', accessible: true }
			]
		});
		fetchArrivalsMock
			.mockResolvedValueOnce(makeArrivalsWithLine(line))
			.mockResolvedValueOnce(makeArrivalsWithLine(line))
			.mockRejectedValueOnce(new Error('temporary poll failure'));

		const store = await createStore();
		store.selectStation(6886);
		await vi.advanceTimersByTimeAsync(0);
		store.selectLine(line, { lat: 44.42, lng: 26.115 });
		await vi.advanceTimersByTimeAsync(0);
		const previousPrimary = store.route?.primary;

		await store.refresh();

		expect(store.route?.status).toBe('ready');
		expect(store.route?.primary).toBe(previousPrimary);
		expect(store.route?.error).toBeNull();
		store.cleanup();
	});
});

describe('fetchArrivals input validation', () => {
	let fetchArrivals: typeof import('$lib/api/arrivals.js').fetchArrivals;

	beforeEach(async () => {
		vi.doUnmock('$lib/api/arrivals.js');
		vi.resetModules();
		const mod = await import('$lib/api/arrivals.js');
		fetchArrivals = mod.fetchArrivals;
	});

	it('rejects an empty array of stop IDs', async () => {
		let threw = false;
		try {
			await fetchArrivals([]);
		} catch (err) {
			threw = true;
			expect(String(err)).toMatch(/ID-uri de stații/);
		}
		expect(threw).toBe(true);
	});

	it('rejects a non-positive stop ID', async () => {
		for (const id of [0, -1]) {
			let threw = false;
			try {
				await fetchArrivals(id);
			} catch (err) {
				threw = true;
				expect(String(err)).toMatch(/număr pozitiv/);
			}
			expect(threw).toBe(true);
		}
	});

	it('rejects a non-integer stop ID', async () => {
		let threw = false;
		try {
			await fetchArrivals(3.5);
		} catch (err) {
			threw = true;
			expect(String(err)).toMatch(/număr pozitiv/);
		}
		expect(threw).toBe(true);
	});

	it('rethrows on first error when all parallel fetches fail', async () => {
		const mod = await import('$lib/api/arrivals.js');
		const allFailedFetch = mod.fetchArrivals;

		let threw = false;
		try {
			await allFailedFetch([1, 2, 3]);
		} catch (err) {
			threw = true;
			expect(err).toBeDefined();
		}
		expect(threw).toBe(true);
	});
});
