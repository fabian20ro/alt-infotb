import L from 'leaflet';

/** Create a blue dot marker for user location */
export function createUserIcon(): L.DivIcon {
	return L.divIcon({
		className: 'user-location-marker',
		html: `<style>@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.7}}</style><div style="
			width: 14px;
			height: 14px;
			border-radius: 50%;
			background: #4285f4;
			border: 3px solid white;
			box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.3), 0 2px 4px rgba(0,0,0,0.3);
			animation: pulse 2s ease-in-out infinite;
		"></div>`,
		iconSize: [20, 20],
		iconAnchor: [10, 10]
	});
}
