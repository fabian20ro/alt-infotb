export interface TileConfig {
	url: string;
	attribution: string;
	maxZoom: number;
}

const SHARED = {
	attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
	maxZoom: 19 as const
};

export const TILE_CONFIGS: Record<string, TileConfig> = {
	light: { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', ...SHARED },
	dark:  { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', ...SHARED }
};
