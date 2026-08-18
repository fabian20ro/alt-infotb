import L from 'leaflet';

/** Vehicle type → color mapping */
const TYPE_COLORS: Record<string, string> = {
	TRAM: '#e63946',
	BUS: '#2a9d8f',
	TROLLEYBUS: '#457b9d',
	SUBWAY: '#1D1D1B'
};

const DEFAULT_COLOR = '#4cc9f0';

/** Base size for the selected (highlighted) station icon */
const SELECTED_SIZE = 28;

interface VariantOpts {
	color: string;
	baseSize: number;
	shadows: string;
}

/** Create a circle marker icon for a station, colored by transport type */
export function createStationIcon(vehicleType?: string): L.DivIcon {
	const normalized = String(vehicleType ?? '').trim().toUpperCase();
	const color = TYPE_COLORS[normalized] ?? DEFAULT_COLOR;
	const s = 30;
	return L.divIcon({
		className: 'station-marker',
		html: `<div style="
			width: 24px;
			height: 24px;
			border-radius: 50%;
			background: ${color};
			border: 3px solid white;
			box-shadow: 0 1px 3px rgba(0,0,0,0.4);
		"></div>`,
		iconSize: [s, s],
		iconAnchor: [Math.round(s / 2), Math.round(s / 2)]
	});
}

/** Create a selected station icon (slightly larger than normal, with subtle glow) */
export function createSelectedStationIcon(): L.DivIcon {
	const color = '#4cc9f0';
	const s = SELECTED_SIZE + 6;
	return L.divIcon({
		className: 'station-marker-selected',
		html: `<div style="
			width: ${SELECTED_SIZE}px;
			height: ${SELECTED_SIZE}px;
			border-radius: 50%;
			background: ${color};
			border: 3px solid white;
			box-shadow: 0 0 0 3px rgba(76, 201, 240, 0.3), 0 1px 4px rgba(0,0,0,0.4);
		"></div>`,
		iconSize: [s, s],
		iconAnchor: [Math.round(s / 2), Math.round(s / 2)]
	});
}

/** Default station icon (no type info) */
export const defaultStationIcon = createStationIcon();
