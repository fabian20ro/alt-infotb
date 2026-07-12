import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StationArrivals } from '$lib/api/types.js';
import { formatArrivalTime, formatTime } from './arrivals.svelte.js';

const fetchArrivalsMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/arrivals.js', () => ({
	fetchArrivals: fetchArrivalsMock
}));

function makeArrivals(stationName: string): StationArrivals {
	return {
		stationName,
		address: 'Bucharest',
		arrivals: [],
		fetchedAt: new Date('2026-02-26T00:00:00.000Z')
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
		expect(result).toMatch(/14[:\.]30/);
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
