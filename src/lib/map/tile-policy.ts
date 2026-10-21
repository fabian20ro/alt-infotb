export const CARTO_ORIGIN = 'https://basemaps.cartocdn.com';
export const ESRI_ORIGIN = 'https://server.arcgisonline.com';
export type TileProvider = 'carto' | 'esri';
export const TILE_MAX_ENTRIES = 500;
export const TILE_MAX_AGE_SECONDS = { carto: 7 * 86400, esri: 86400 } as const;
export const TILE_EXPIRY_HEADER = 'x-alt-infotb-tile-expires';

export function getTileProvider(url: URL): TileProvider | undefined {
	if (url.origin === CARTO_ORIGIN && /^\/(?:dark_all|light_all|rastertiles\/voyager)\/\d+\/\d+\/\d+(?:@2x)?\.png$/.test(url.pathname)) return 'carto';
	if (url.origin === ESRI_ORIGIN && /^\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+$/.test(url.pathname)) return 'esri';
	return undefined;
}

// Exact incident signatures, not a general detector of every provider error image.
const CARTO_PLACEHOLDER_HASHES = new Set([
	'cc3f31364a735d9a8179af36b3db7617cdff8bdb0248654ebcc3df91607abedc',
	'69be4aecf9f814ba45d585801a5aa41e79b16fc88eafec5b1954a9f06a69e6be'
]);

export async function isKnownCartoPlaceholder(bytes: ArrayBuffer): Promise<boolean> {
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return CARTO_PLACEHOLDER_HASHES.has(hex);
}

export function tileCachePrefix(scope: string): string {
	return `alt-infotb-map-${encodeURIComponent(new URL(scope).pathname)}-`;
}

export function tileCacheName(scope: string, provider: TileProvider): string {
	return `${tileCachePrefix(scope)}v2-${provider}`;
}

/** Application TTL is a ceiling; never extend the provider's explicit freshness. */
export function tileFreshnessSeconds(headers: Headers, provider: TileProvider, now = Date.now()): number {
	const control = headers.get('cache-control') ?? '';
	if (/(?:^|,)\s*(?:no-store|no-cache|private)\b/i.test(control)) return 0;
	const maxAge = control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)/i);
	const expires = Date.parse(headers.get('expires') ?? '');
	const date = Date.parse(headers.get('date') ?? '');
	const age = Number(headers.get('age') ?? '0');
	const apparentAge = Number.isFinite(date) ? Math.max(0, (now - date) / 1000) : 0;
	const currentAge = Math.max(Number.isFinite(age) ? age : 0, apparentAge);
	const providerTTL = maxAge ? Number(maxAge[1]) - currentAge
		: Number.isFinite(expires) ? (expires - now) / 1000
		: provider === 'esri' ? 0 : TILE_MAX_AGE_SECONDS.carto;
	return Math.max(0, Math.min(TILE_MAX_AGE_SECONDS[provider], providerTTL));
}

export function isFreshTile(response: Response, now = Date.now()): boolean {
	const expiry = Number(response.headers.get(TILE_EXPIRY_HEADER));
	return response.status === 200 && expiry > now;
}

/** Validate before either display or storage; never turn an error image into a successful tile. */
export async function validateTileResponse(response: Response, provider: TileProvider): Promise<Response> {
	if (response.status >= 400) {
		const headers = new Headers({ 'cache-control': 'no-store' });
		const retryAfter = response.headers.get('retry-after');
		if (retryAfter) headers.set('retry-after', retryAfter);
		return new Response('Map tile unavailable', { status: response.status, headers });
	}
	if (response.status !== 200 || response.type === 'opaque' || !/^image\//i.test(response.headers.get('content-type') ?? '')) {
		return new Response('Map tile unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
	}
	if (provider === 'carto' && await isKnownCartoPlaceholder(await response.clone().arrayBuffer())) {
		return new Response('Map provider authorization required', { status: 503, headers: { 'cache-control': 'no-store' } });
	}
	return response;
}

export function prepareTileForCache(response: Response, provider: TileProvider, now = Date.now()): Response | null {
	if (response.status !== 200 || response.type === 'opaque' || !/^image\//i.test(response.headers.get('content-type') ?? '')) return null;
	const ttl = tileFreshnessSeconds(response.headers, provider, now);
	if (ttl <= 0) return null;
	const headers = new Headers(response.headers);
	// Fetch exposes decoded bytes; do not retain transport framing on a new Response.
	headers.delete('content-encoding');
	headers.delete('content-length');
	headers.set(TILE_EXPIRY_HEADER, String(now + ttl * 1000));
	return new Response(response.body, { status: 200, headers });
}
