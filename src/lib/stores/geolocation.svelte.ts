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
	let permission = $state<'granted' | 'denied' | 'prompt'>('prompt');
	let watching = $state(false);
	let watchId: number | null = null;

	/** Update permission status */
	async function updatePermissionStatus() {
		if (!navigator.permissions) return;
		try {
			const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
			permission = status.state;
			status.onchange = () => {
				permission = status.state;
			};
		} catch {
			// Fallback
		}
	}

	/** Get the best available center: GPS > Bucharest default */
	function getCenter(): { lat: number; lon: number } {
		if (position) return { lat: position.lat, lon: position.lon };
		return BUCHAREST_CENTER;
	}

	function startWatching(): void {
		if (watching || !navigator.geolocation) return;

		updatePermissionStatus();

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
				permission = 'granted';
			},
			(geoErr) => {
				error = geoErr.message;
				if (geoErr.code === geoErr.PERMISSION_DENIED) {
					permission = 'denied';
				}
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
		get permission() { return permission; },
		get watching() { return watching; },
		getCenter,
		startWatching,
		stopWatching
	};
}
