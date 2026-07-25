import L from 'leaflet';

/** Vehicle type → color mapping */
const TYPE_COLORS: Record<string, string> = {
	TRAM: '#e63946',
	BUS: '#2a9d8f',
	TROLLEYBUS: '#457b9d',
	SUBWAY: '#1D1D1B'
};

const DEFAULT_COLOR = '#888888';

/** Base size for the selected (highlighted) station icon */
const SELECTED_SIZE = 28;

interface VariantOpts {
	color: string;
	baseSize: number;
	shadows: string;
}

/** Build a station marker icon from variant parameters */
function buildVariant(opts: VariantOpts): L.DivIcon {
	const s = opts.baseSize + 6;
	return L.divIcon({
		className: `station-marker${opts.baseSize === SELECTED_SIZE ? '-selected' : ''}`,
		html: `<div style="
			width: ${opts.baseSize}px;
			height: ${opts.baseSize}px;
			border-radius: 50%;
			background: ${opts.color};
			border: 3px solid white;
			box-shadow: ${opts.shadows};
		"></div>`,
		iconSize: [s, s],
		iconAnchor: [Math.round(s / 2), Math.round(s / 2)]
	});
}

/** Create a circle marker icon for a station, colored by transport type */
export function createStationIcon(vehicleType?: string): L.DivIcon {
	const normalized = String(vehicleType ?? '').trim().toUpperCase();
	return buildVariant({
		color: TYPE_COLORS[normalized] ?? DEFAULT_COLOR,
		baseSize: 24,
		shadows: '0 1px 3px rgba(0,0,0,0.4)'
	});
}

/** Create a selected station icon (slightly larger than normal, with subtle glow) */
export function createSelectedStationIcon(): L.DivIcon {
	return buildVariant({
		color: '#4cc9f0',
		baseSize: SELECTED_SIZE,
		shadows: '0 0 0 3px rgba(76, 201, 240, 0.3), 0 1px 4px rgba(0,0,0,0.4)'
	});
}

/** Default station icon (no type info) */
export const defaultStationIcon = createStationIcon();
