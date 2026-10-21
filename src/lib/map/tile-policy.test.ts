import { describe, expect, it } from 'vitest';
import {
	CARTO_ORIGIN, ESRI_ORIGIN, getTileProvider, isFreshTile, isKnownCartoPlaceholder,
	prepareTileForCache, tileCacheName, tileCooldownUntil, tileFreshnessSeconds, validateTileResponse
} from './tile-policy';

const now = Date.parse('2026-10-21T10:00:00Z');
const image = (headers: Record<string, string> = {}) => new Response('synthetic image', {
	headers: { 'content-type': 'image/png', ...headers }
});

describe('map tile boundaries', () => {
	it('matches only supported provider/style tile paths, including voyager and retina', () => {
		for (const style of ['dark_all', 'light_all', 'rastertiles/voyager']) {
			expect(getTileProvider(new URL(`${CARTO_ORIGIN}/${style}/15/18759/11860@2x.png?key=test`))).toBe('carto');
		}
		expect(getTileProvider(new URL(`${ESRI_ORIGIN}/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/11860/18759`))).toBe('esri');
		for (const url of ['https://example.com/dark_all/1/2/3.png', `${CARTO_ORIGIN}/not-tiles.png`, `${ESRI_ORIGIN}/other/tile/1/2/3`]) {
			expect(getTileProvider(new URL(url))).toBeUndefined();
		}
	});

	it('isolates tile cache namespaces between application scopes and providers', () => {
		expect(tileCacheName('https://example.com/alt-infotb/', 'carto')).not.toBe(tileCacheName('https://example.com/other-app/', 'carto'));
		expect(tileCacheName('https://example.com/alt-infotb/', 'carto')).not.toBe(tileCacheName('https://example.com/alt-infotb/', 'esri'));
	});
});

describe('provider freshness and strict cache expiration', () => {
	it.each(['no-store', 'public, no-cache', 'private, max-age=3600', 'max-age=0'])(
		'respects %s instead of overriding provider directives', (control) => {
			expect(prepareTileForCache(image({ 'cache-control': control }), 'carto', now)).toBeNull();
		}
	);

	it('subtracts upstream Age and apparent age before the application TTL ceiling', () => {
		expect(tileFreshnessSeconds(new Headers({ 'cache-control': 'public, max-age=3600', age: '60' }), 'carto', now)).toBe(3540);
		expect(tileFreshnessSeconds(new Headers({ 'cache-control': 'max-age=3600', date: new Date(now - 120000).toUTCString() }), 'carto', now)).toBe(3480);
		expect(tileFreshnessSeconds(new Headers({ 'cache-control': 'max-age=2592000' }), 'carto', now)).toBe(7 * 86400);
		expect(tileFreshnessSeconds(new Headers({ 'cache-control': 'max-age=2592000' }), 'esri', now)).toBe(86400);
	});

	it('does not cache satellite responses without explicit readable freshness', () => {
		expect(prepareTileForCache(image(), 'esri', now)).toBeNull();
		expect(tileFreshnessSeconds(new Headers({ expires: new Date(now + 10000).toUTCString() }), 'esri', now)).toBe(10);
	});

	it('stores a fixed deadline and rejects expired or unstamped entries immediately', () => {
		const cached = prepareTileForCache(image({ 'cache-control': 'max-age=60' }), 'carto', now)!;
		expect(isFreshTile(cached, now + 59000)).toBe(true);
		expect(isFreshTile(cached, now + 60000)).toBe(false);
		expect(isFreshTile(image(), now)).toBe(false);
	});
});

describe('response validation', () => {
	it.each(['carto', 'esri'] as const)('waits for the complete %s body before declaring a tile valid', async (provider) => {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
		const response = new Response(stream, { headers: { 'content-type': 'image/png' } });
		let settled = false;
		const validation = validateTileResponse(response, provider).then((value) => { settled = true; return value; });
		controller.enqueue(new TextEncoder().encode('partial image'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(settled).toBe(false);
		controller.close();
		expect(await validation).toBe(response);
	});

	it('propagates an aborted satellite body instead of caching a partial response', async () => {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
		const validation = validateTileResponse(new Response(stream, { headers: { 'content-type': 'image/jpeg' } }), 'esri');
		const rejection = expect(validation).rejects.toThrow('body deadline');
		controller.error(new DOMException('body deadline', 'AbortError'));
		await rejection;
	});

	it.each([401, 403, 429, 500, 503])('does not cache or render HTTP %s error bodies as tiles', async (status) => {
		const result = await validateTileResponse(new Response('error image', {
			status, headers: { 'content-type': 'image/png', 'retry-after': '30' }
		}), 'carto');
		expect(result.status).toBe(status);
		expect(result.headers.get('retry-after')).toBe('30');
		expect(result.headers.get('content-type')).not.toContain('image/');
		expect(prepareTileForCache(result, 'carto', now)).toBeNull();
	});

	it('rejects opaque responses and success HTML', async () => {
		expect((await validateTileResponse(Response.error(), 'carto')).status).toBe(502);
		expect((await validateTileResponse(new Response('<html>error</html>'), 'carto')).status).toBe(502);
	});

	it('does not infer authorization failure from a small or uniform tile', async () => {
		const bytes = new TextEncoder().encode('a small legitimate tile').buffer;
		expect(await isKnownCartoPlaceholder(bytes)).toBe(false);
		const response = image();
		expect(await validateTileResponse(response, 'carto')).toBe(response);
	});
});

describe('provider cooldown', () => {
	it.each([429, 503])('honors Retry-After seconds and HTTP dates for %s', (status) => {
		expect(tileCooldownUntil(new Response(null, { status, headers: { 'retry-after': '120' } }), now)).toBe(now + 120000);
		expect(tileCooldownUntil(new Response(null, { status, headers: { 'retry-after': new Date(now + 30000).toUTCString() } }), now)).toBe(now + 30000);
		expect(tileCooldownUntil(new Response(null, { status, headers: { 'retry-after': '0' } }), now)).toBe(now);
	});

	it.each([undefined, 'invalid', '9'.repeat(400)])('uses 15 seconds for absent or unusable Retry-After (%s)', (retryAfter) => {
		expect(tileCooldownUntil(new Response(null, { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} }), now)).toBe(now + 15000);
	});

	it('does not impose rate-limit cooldown for successful tiles or unrelated errors', () => {
		for (const status of [200, 401, 403, 404, 500]) expect(tileCooldownUntil(new Response(null, { status }), now)).toBe(0);
	});
});
