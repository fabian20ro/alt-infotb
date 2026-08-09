import L from 'leaflet';

/** Create a blue dot marker for user location */
export function createUserIcon(): L.DivIcon {
	const icon = L.divIcon({
		className: 'user-location-marker',
		html: `<style>@keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.25);opacity:.7}}@media(prefers-reduced-motion:reduce){.user-location-marker div{animation:none}}</style><div style="
			width: 16px;
			height: 16px;
			border-radius: 50%;
			background: #4285f4;
			border: 3px solid white;
			outline: 4px solid rgba(255, 255, 255, 0.4);
			box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.3), 0 2px 4px rgba(0,0,0,0.3);
			animation: pulse 4s ease-in-out infinite;
		"></div>`,
		iconSize: [28, 28],
		iconAnchor: [14, 14]
	});

	return icon;
}
