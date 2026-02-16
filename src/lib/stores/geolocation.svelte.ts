/** Default center: Bucharest (Piata Unirii area) */
const BUCHAREST_CENTER = { lat: 44.4268, lon: 26.1025 };
const STORAGE_KEY = 'alt-stb-last-position';

export interface GeoPosition {
	lat: number;
	lon: number;
	accuracy: number;
}

export function createGeolocationStore() {
	let position = $state<GeoPosition | null>(null);
	let error = $state<string | null>(null);
	let watching = $state(false);
	let watchId: number | null = null;

	/** Load last known position from localStorage */
	function loadSavedPosition(): GeoPosition | null {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return null;
			return JSON.parse(raw) as GeoPosition;
		} catch {
			return null;
		}
	}

	/** Save position to localStorage */
	function savePosition(pos: GeoPosition): void {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
		} catch {
			// Silently fail
		}
	}

	/** Get the best available center: GPS > saved > Bucharest default */
	function getCenter(): { lat: number; lon: number } {
		if (position) return { lat: position.lat, lon: position.lon };
		const saved = loadSavedPosition();
		if (saved) return { lat: saved.lat, lon: saved.lon };
		return BUCHAREST_CENTER;
	}

	function startWatching(): void {
		if (watching || !navigator.geolocation) return;

		// Try saved position first for immediate use
		const saved = loadSavedPosition();
		if (saved && !position) {
			position = saved;
		}

		watching = true;
		error = null;

		watchId = navigator.geolocation.watchPosition(
			(geoPos) => {
				const newPos: GeoPosition = {
					lat: geoPos.coords.latitude,
					lon: geoPos.coords.longitude,
					accuracy: geoPos.coords.accuracy
				};
				position = newPos;
				error = null;
				savePosition(newPos);
			},
			(geoErr) => {
				error = geoErr.message;
			},
			{
				enableHighAccuracy: true,
				maximumAge: 30_000,
				timeout: 10_000
			}
		);
	}

	function stopWatching(): void {
		if (watchId !== null) {
			navigator.geolocation.clearWatch(watchId);
			watchId = null;
		}
		watching = false;
	}

	return {
		get position() { return position; },
		get error() { return error; },
		get watching() { return watching; },
		getCenter,
		startWatching,
		stopWatching
	};
}
