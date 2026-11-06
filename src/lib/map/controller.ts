import type { MapScene, RouteOverviewRequest } from './model.js';
import type { MapPoint, MapRenderer } from './renderer.js';

export interface LocationStatus {
	pending: boolean;
	error: 'locationDenied' | 'locationUnavailable' | null;
}

/** Camera intents are independent of polling, Svelte effects and rendering engines. */
export function createMapController(renderer: MapRenderer, onStatus: (status: LocationStatus) => void) {
	let scene: MapScene | null = null;
	let pending = false;
	let error: LocationStatus['error'] = null;
	let initialViewSet = false;
	let overview: RouteOverviewRequest | null = null;
	let handledOverviewId = 0;

	function applyRecenter() {
		if (!scene || !pending) return;
		if (scene.locationPermission === 'denied' || (!scene.userPosition && scene.locationError)) {
			pending = false;
			error = scene.locationPermission === 'denied' ? 'locationDenied' : 'locationUnavailable';
			return;
		}
		if (!scene.userPosition) return;
		// Clear before setCamera: engines may emit camera-idle synchronously.
		pending = false;
		const { lat, lon } = scene.userPosition;
		const previousInitialView = initialViewSet;
		initialViewSet = true;
		if (!renderer.setCamera({ lat, lon, zoom: 15 }, true)) {
			initialViewSet = previousInitialView;
			pending = true;
		}
	}

	function setInitialView() {
		if (!scene || initialViewSet || pending || scene.allStations.length === 0) return;
		const points: MapPoint[] = [];
		if (scene.userPosition) points.push(scene.userPosition);
		const selected = scene.allStations.find((station) => station.id === scene!.selectedStationId);
		if (selected) points.push(selected);
		// Set before synchronous camera events; retry if the renderer rejects it.
		initialViewSet = true;
		if (points.length > 1) initialViewSet = renderer.fitPoints(points, 'initial');
		else if (points.length === 1) {
			const { lat, lon } = points[0];
			initialViewSet = renderer.setCamera({ lat, lon, zoom: 15 }, false);
		}
	}

	function applyOverview() {
		if (!scene || !overview || overview.id <= handledOverviewId) return;
		if (!scene.route || overview.routeKey !== scene.route.key) {
			handledOverviewId = overview.id;
			return;
		}
		const points = [...(scene.route.primary?.path ?? []), ...(scene.route.opposite?.path ?? [])]
			.map(({ lat, lng }) => ({ lat, lon: lng }));
		if (points.length < 2) return;
		const previousId = handledOverviewId;
		handledOverviewId = overview.id;
		if (!renderer.fitPoints(points, 'overview')) handledOverviewId = previousId;
	}

	function settle() {
		applyRecenter();
		setInitialView();
		applyOverview();
		onStatus({ pending, error });
	}

	return {
		update(nextScene: MapScene) {
			scene = nextScene;
			renderer.render(scene);
			if ((error === 'locationDenied' && scene.locationPermission !== 'denied') ||
				(error === 'locationUnavailable' && scene.userPosition && !scene.locationError)) error = null;
			settle();
		},
		recenter() { error = null; pending = true; settle(); },
		overview(request: RouteOverviewRequest | null) { overview = request; applyOverview(); },
		cameraIdle: settle
	};
}
