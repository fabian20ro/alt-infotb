import L from 'leaflet';

/** Vehicle type → color mapping */
const TYPE_COLORS: Record<string, string> = {
	TRAM: '#e63946',
	BUS: '#2a9d8f',
	TROLLEYBUS: '#457b9d'
};

const DEFAULT_COLOR = '#888888';

/** Create a circle marker icon for a station, colored by transport type */
export function createStationIcon(vehicleType?: string): L.DivIcon {
	const color = TYPE_COLORS[vehicleType ?? ''] ?? DEFAULT_COLOR;
	return L.divIcon({
		className: 'station-marker',
		html: `<div style="
			width: 12px;
			height: 12px;
			border-radius: 50%;
			background: ${color};
			border: 2px solid white;
			box-shadow: 0 1px 3px rgba(0,0,0,0.4);
		"></div>`,
		iconSize: [16, 16],
		iconAnchor: [8, 8]
	});
}

/** Create a selected station icon (larger, with pulse) */
export function createSelectedStationIcon(): L.DivIcon {
	return L.divIcon({
		className: 'station-marker-selected',
		html: `<div style="
			width: 18px;
			height: 18px;
			border-radius: 50%;
			background: #4cc9f0;
			border: 3px solid white;
			box-shadow: 0 0 0 4px rgba(76, 201, 240, 0.3), 0 2px 6px rgba(0,0,0,0.4);
		"></div>`,
		iconSize: [24, 24],
		iconAnchor: [12, 12]
	});
}

/** Default station icon (no type info) */
export const defaultStationIcon = createStationIcon();
