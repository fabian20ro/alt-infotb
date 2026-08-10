export interface TileConfig {
	url: string;
	attribution: string;
	maxZoom: number;
}

const SHARED = {
	attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
	maxZoom: 19 as const
};

export const TILE_THEMES = ['light', 'dark', 'satellite'] as const;

export function getTileConfig(key: string): TileConfig {
	const config = (TILE_CONFIGS as Record<string, TileConfig | undefined>)[key];
	if (!config) {
		throw new Error(`Unknown tile theme: ${key}. Expected one of: ${TILE_THEMES.join(', ')}`);
	}
	return config;
}

export const TILE_CONFIGS: Record<string, TileConfig> = {
	light:     { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', ...SHARED },
	dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', ...SHARED },
	satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '&copy; Esri, Maxar, Earthstar Geographics © OpenStreetMap contributors, USDA, USGS, AeroGRID, IGN Spain', maxZoom: 19 as const }
};

// Cross-validate TILE_THEMES and TILE_CONFIGS at import time — mismatches are caught before MapView runs.
for (const key of Object.keys(TILE_CONFIGS)) {
	if (!TILE_THEMES.includes(key as 'light' | 'dark' | 'satellite')) {
		throw new Error(`Unknown tile theme "${key}" declared in TILE_CONFIGS but missing from TILE_THEMES`);
	}
}
