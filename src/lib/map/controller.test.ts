import { describe, expect, it } from 'vitest';
import { createMapController, type LocationStatus } from './controller.js';
import { createMapScene, type MapScene } from './model.js';
import type { MapCamera, MapPoint, MapRenderer } from './renderer.js';

function harness() {
	const cameraMoves: MapCamera[] = [];
	const frames: { points: readonly MapPoint[]; purpose: string }[] = [];
	const scenes: MapScene[] = [];
	const statuses: LocationStatus[] = [];
	let blocked = false;
	let idle: (() => void) | undefined;
	const renderer: MapRenderer = {
		render(scene) { scenes.push(scene); }, setBasemap() {}, retryBasemap() {}, destroy() {},
		fitPoints(points, purpose) {
			if (blocked) return false;
			frames.push({ points, purpose }); idle?.(); return true;
		},
		setCamera(camera) { if (blocked) return false; cameraMoves.push(camera); idle?.(); return true; }
	};
	const controller = createMapController(renderer, (status) => statuses.push(status));
	return { cameraMoves, frames, scenes, statuses, controller,
		block(value: boolean) { blocked = value; },
		synchronousIdle() { idle = controller.cameraIdle; } };
}
const scene = () => createMapScene({ allStations: [], selectedStationId: null,
	userPosition: null, locationPermission: 'prompt', locationError: null, theme: 'dark', route: null });
const routeScene = (): MapScene => ({ ...scene(), route: {
	key: '6207:796:0', lineId: 796, lineName: '429', vehicleType: 'BUS',
	primary: { lineName: '429', vehicleType: 'BUS', direction: 'Forward', color: '#0077b6',
		path: [{ lat: 44.42, lng: 26.1 }, { lat: 44.43, lng: 26.11 }], vehicles: [] },
	opposite: { lineName: '429', vehicleType: 'BUS', direction: 'Return', color: '#0077b6',
		path: [{ lat: 44.44, lng: 26.12 }, { lat: 44.45, lng: 26.13 }], vehicles: [] }
} });

describe('map camera intents', () => {
	it('retains a recenter until both GPS and the renderer are ready; later GPS updates do not follow', () => {
		const h = harness();
		h.controller.update(scene());
		h.controller.recenter();
		expect(h.statuses.at(-1)).toEqual({ pending: true, error: null });
		h.block(true);
		h.controller.update({ ...scene(), userPosition: { lat: 44.437, lon: 26.12, accuracy: 20 } });
		expect(h.cameraMoves).toEqual([]);
		h.block(false);
		h.controller.cameraIdle();
		expect(h.cameraMoves).toEqual([{ lat: 44.437, lon: 26.12, zoom: 15 }]);
		expect(h.statuses.at(-1)).toEqual({ pending: false, error: null });
		h.controller.update({ ...scene(), userPosition: { lat: 44.438, lon: 26.121, accuracy: 20 } });
		h.controller.cameraIdle();
		expect(h.cameraMoves).toHaveLength(1);
	});

	it('consumes recenter before synchronous engine events to prevent recursion', () => {
		const h = harness(); h.synchronousIdle();
		h.controller.update({ ...scene(), userPosition: { lat: 44.437, lon: 26.12, accuracy: 20 } });
		h.controller.recenter();
		expect(h.cameraMoves).toEqual([{ lat: 44.437, lon: 26.12, zoom: 15 }]);
	});

	it.each([
		{ locationPermission: 'denied' as const, locationError: null, error: 'locationDenied' },
		{ locationPermission: 'granted' as const, locationError: 'GPS unavailable', error: 'locationUnavailable' }
	])('cancels a pending request on $error and clears its status after recovery', (failure) => {
		const h = harness(); h.controller.update(scene()); h.controller.recenter();
		h.controller.update({ ...scene(), ...failure });
		expect(h.statuses.at(-1)).toEqual({ pending: false, error: failure.error });
		h.controller.update({ ...scene(), userPosition: { lat: 44.437, lon: 26.12, accuracy: 20 } });
		expect(h.statuses.at(-1)).toEqual({ pending: false, error: null });
		expect(h.cameraMoves).toEqual([]);
	});

	it('fits initial selection and GPS once, without moving on subsequent scene updates', () => {
		const h = harness(); h.synchronousIdle();
		const first = { ...scene(), allStations: [{ id: 1, name: 'A', description: '', lat: 44.43, lon: 26.1 }],
			selectedStationId: 1, userPosition: { lat: 44.42, lon: 26.11, accuracy: 20 } };
		h.controller.update(first); h.controller.update({ ...first, theme: 'light' });
		expect(h.frames).toEqual([{ purpose: 'initial', points: [first.userPosition, first.allStations[0]] }]);
		expect(h.scenes).toHaveLength(2);
	});

	it('fits both directions only on explicit overview; polling and theme changes preserve the camera', () => {
		const h = harness(); h.synchronousIdle();
		h.controller.update(routeScene());
		expect(h.frames).toEqual([]);
		h.controller.overview({ id: 1, routeKey: '6207:796:0' });
		expect(h.frames).toEqual([{ purpose: 'overview', points: [
			{ lat: 44.42, lon: 26.1 }, { lat: 44.43, lon: 26.11 },
			{ lat: 44.44, lon: 26.12 }, { lat: 44.45, lon: 26.13 }
		] }]);
		h.controller.update({ ...routeScene(), theme: 'light' });
		h.controller.overview({ id: 1, routeKey: '6207:796:0' });
		expect(h.frames).toHaveLength(1);
	});

	it('retries an overview blocked by animation and never replays one for a different route', () => {
		const h = harness(); h.controller.update(routeScene()); h.block(true);
		h.controller.overview({ id: 1, routeKey: '6207:796:0' });
		expect(h.frames).toEqual([]);
		h.block(false); h.controller.cameraIdle(); h.controller.cameraIdle();
		expect(h.frames).toHaveLength(1);
		h.controller.overview({ id: 2, routeKey: 'different-route' });
		h.controller.update({ ...routeScene(), route: { ...routeScene().route!, key: 'different-route' } });
		expect(h.frames).toHaveLength(1);
	});

	it('waits for missing route geometry before consuming an overview request', () => {
		const h = harness();
		h.controller.update({ ...routeScene(), route: { ...routeScene().route!, primary: null, opposite: null } });
		h.controller.overview({ id: 1, routeKey: '6207:796:0' });
		expect(h.frames).toEqual([]);
		h.controller.update(routeScene());
		expect(h.frames).toHaveLength(1);
	});
});
