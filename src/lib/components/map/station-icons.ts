import L from 'leaflet';

/** Vehicle type → color mapping */
const TYPE_COLORS: Record<string, string> = {
	TRAM: '#e63946',
	BUS: '#2a9d8f',
	TROLLEYBUS: '#457b9d',
	SUBWAY: '#1D1D1B'
};

const DEFAULT_COLOR = '#888888';

/** Create a circle marker icon for a station, colored by transport type */
export function createStationIcon(vehicleType?: string): L.DivIcon {
	const color = TYPE_COLORS[vehicleType ?? ''] ?? DEFAULT_COLOR;
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
		iconSize: [30, 30],
		iconAnchor: [15, 15]
	});
}

/** Create a selected station icon (larger, with pulse) */
export function createSelectedStationIcon(): L.DivIcon {
	return L.divIcon({
		className: 'station-marker-selected',
		html: `<div style="
			width: 36px;
			height: 36px;
			border-radius: 50%;
			background: #4cc9f0;
			border: 4px solid white;
			box-shadow: 0 0 0 4px rgba(76, 201, 240, 0.3), 0 2px 6px rgba(0,0,0,0.4);
		"></div>`,
		iconSize: [44, 44],
		iconAnchor: [22, 22]
	});
}

/** Default station icon (no type info) */
export const defaultStationIcon = createStationIcon();
