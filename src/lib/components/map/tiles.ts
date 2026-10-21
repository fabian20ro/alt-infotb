import { CARTO_ORIGIN, ESRI_ORIGIN, isKnownCartoPlaceholder } from '../../map/tile-policy.js';

export interface TileConfig {
	/** A missing key disables the street layer; never request anonymous CARTO tiles. */
	url: string | null;
	attribution: string;
	maxZoom: number;
	crossOrigin: 'anonymous';
}

export const TILE_THEMES = ['light', 'dark', 'satellite'] as const;
export type TileTheme = typeof TILE_THEMES[number];
export const TILE_RETRY_COOLDOWN_MS = 15_000;

const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
const ESRI_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics © OpenStreetMap contributors, USDA, USGS, AeroGRID, IGN Spain';

export function getTileConfig(theme: string, apiKey = import.meta.env.VITE_CARTO_API_KEY): TileConfig {
	if (!TILE_THEMES.includes(theme as TileTheme)) {
		throw new Error(`Unknown tile theme: ${theme}. Expected one of: ${TILE_THEMES.join(', ')}`);
	}
	if (theme === 'satellite') {
		return {
			url: `${ESRI_ORIGIN}/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
			attribution: ESRI_ATTRIBUTION,
			maxZoom: 19,
			crossOrigin: 'anonymous'
		};
	}
	const key = apiKey?.trim();
	const style = theme === 'light' ? 'rastertiles/voyager' : 'dark_all';
	return {
		url: key ? `${CARTO_ORIGIN}/${style}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}` : null,
		attribution: CARTO_ATTRIBUTION,
		maxZoom: 19,
		crossOrigin: 'anonymous'
	};
}

/** Leaflet's `load` means every tile settled, including failures. Track failures
 * until that tile succeeds or leaves the viewport, rather than treating load as success. */
export function createTileHealthTracker() {
	const failures = new Set<object>();
	let successfulTiles = 0;
	return {
		failed(tile: object) { failures.add(tile); },
		loaded(tile: object) { failures.delete(tile); successfulTiles++; },
		unloaded(tile: object) { failures.delete(tile); },
		isHealthy() { return successfulTiles > 0 && failures.size === 0; }
	};
}

/** Probe one visible tile before the first uncontrolled page loads a whole layer.
 * A valid PNG can still be CARTO's API-key placeholder, hence content verification. */
export async function verifyCartoTile(url: string, signal: AbortSignal): Promise<boolean> {
	const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal });
	if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) {
		await response.body?.cancel();
		return false;
	}
	return !await isKnownCartoPlaceholder(await response.arrayBuffer());
}

export function centerTileUrl(template: string, lat: number, lon: number, zoom: number): string {
	const z = Math.max(0, Math.min(19, Math.floor(zoom)));
	const scale = 2 ** z;
	const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
	const latitudeRadians = clampedLat * Math.PI / 180;
	const x = ((Math.floor((lon + 180) / 360 * scale) % scale) + scale) % scale;
	const y = Math.max(0, Math.min(scale - 1, Math.floor((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * scale)));
	return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{r}', '');
}
