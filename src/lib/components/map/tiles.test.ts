import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { centerTileUrl, createTileHealthTracker, getTileConfig } from './tiles.js';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('basemap provider configuration', () => {
	it.each(['light', 'dark'])('never requests %s CARTO without a usable key', (theme) => {
		for (const key of ['', '  \n\t']) expect(getTileConfig(theme, key).url).toBeNull();
	});

	it('trims and encodes the key without corrupting Leaflet placeholders', () => {
		const config = getTileConfig('light', '  key+with&reserved=characters  ');
		expect(config.url).toBe('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=key%2Bwith%26reserved%3Dcharacters');
		expect(config.crossOrigin).toBe('anonymous');
		expect(config.attribution).toContain('CARTO');
	});

	it('keeps satellite independent of the CARTO key with its own attribution', () => {
		const config = getTileConfig('satellite', '');
		expect(config.url).toContain('https://server.arcgisonline.com/');
		expect(config.url).not.toContain('key=');
		expect(config.crossOrigin).toBe('anonymous');
		expect(config.attribution).toContain('Esri');
		expect(config.attribution).not.toContain('CARTO');
	});

	it('rejects unsupported providers instead of constructing an unintended request', () => {
		expect(() => getTileConfig('unknown', 'key')).toThrow('Unknown tile theme');
	});

	it('probes the current visible area and preserves authentication', () => {
		expect(centerTileUrl(getTileConfig('dark', 'key&one').url!, 44.4268, 26.1025, 15))
			.toBe('https://basemaps.cartocdn.com/dark_all/15/18759/11860.png?key=key%26one');
	});

	it('wraps world copies and clamps polar coordinates to valid tiles', () => {
		expect(centerTileUrl('/{z}/{x}/{y}{r}', 90, 540, 2)).toBe('/2/0/0');
		expect(centerTileUrl('/{z}/{x}/{y}{r}', -90, -540, 2)).toBe('/2/0/3');
	});
});

describe('Leaflet tile batch health', () => {
	it('does not confuse a completed mixed-success batch with a working map', () => {
		const tracker = createTileHealthTracker();
		const failed = {};
		tracker.failed(failed);
		tracker.loaded({});
		expect(tracker.isHealthy()).toBe(false);
		tracker.loaded(failed);
		expect(tracker.isHealthy()).toBe(true);
	});

	it('recovers after a failed tile leaves the viewport and new tiles succeed', () => {
		const tracker = createTileHealthTracker();
		const failed = {};
		tracker.failed(failed);
		tracker.unloaded(failed);
		expect(tracker.isHealthy()).toBe(false);
		tracker.loaded({});
		expect(tracker.isHealthy()).toBe(true);
	});
});

describe('uncontrolled-page tile preflight', () => {
	let verifyCartoTile: typeof import('./tiles.js').verifyCartoTile;
	beforeEach(async () => {
		// Each test represents a fresh page with an independent provider cooldown.
		vi.resetModules();
		({ verifyCartoTile } = await import('./tiles.js'));
	});

	it('honors Retry-After across theme changes and retries until the deadline', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '120' } }))
			.mockResolvedValueOnce(new Response('', { status: 503 }));
		vi.stubGlobal('fetch', fetchMock);
		const signal = new AbortController().signal;
		expect(await verifyCartoTile('https://example.com/dark.png', signal)).toBe(false);
		expect(await verifyCartoTile('https://example.com/light.png', signal)).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(119_999);
		expect(await verifyCartoTile('https://example.com/dark.png', signal)).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1);
		expect(await verifyCartoTile('https://example.com/dark.png', signal)).toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it.each([401, 403, 429, 500])('rejects HTTP %s before creating the layer', async (status) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
		expect(await verifyCartoTile('https://example.com/tile', new AbortController().signal)).toBe(false);
	});

	it('rejects an HTML error served as HTTP 200', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { headers: { 'content-type': 'text/html' } })));
		expect(await verifyCartoTile('https://example.com/tile', new AbortController().signal)).toBe(false);
	});

	it('rejects the actual incident placeholder even when served as a valid PNG with HTTP 200', async () => {
		const bytes = readFileSync(new URL('../../../../e2e/fixtures/carto-api-key-required.png', import.meta.url));
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/png' } })));
		expect(await verifyCartoTile('https://example.com/tile', new AbortController().signal)).toBe(false);
	});

	it('passes cancellation through to the CORS request', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		controller.abort();
		await expect(verifyCartoTile('https://example.com/tile', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
		expect(fetchMock).toHaveBeenCalledWith('https://example.com/tile', {
			mode: 'cors', credentials: 'omit', signal: controller.signal
		});
	});
});
