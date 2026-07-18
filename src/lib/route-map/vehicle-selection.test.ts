import { describe, expect, it } from 'vitest';
import {
	AMBIGUITY_PROGRESS_GAP,
	APPROACHING_TOLERANCE_METERS,
	MAX_ROUTE_DISTANCE_METERS,
	NEAR_ROUTE_END_FRACTION,
	classifyOppositeTurnaroundVehicles,
	classifySameDirectionVehicles,
	isPointNearRouteOrigin,
	projectPointOntoRoute,
	type GeoPoint,
} from './vehicle-selection.js';

const point = (lng: number, lat = 0): GeoPoint => ({ lat, lng });
const eastbound = [point(0), point(0.01)];

describe('projectPointOntoRoute', () => {
	it('projects onto directed distance and progress', () => {
		const projection = projectPointOntoRoute(point(0.0025, 0.0001), eastbound);

		expect(projection).not.toBeNull();
		expect(projection!.progress).toBeCloseTo(0.25, 3);
		expect(projection!.distanceAlongRouteMeters).toBeCloseTo(278, -1);
		expect(projection!.distanceFromRouteMeters).toBeCloseTo(11, 0);
		expect(projection!.segmentIndex).toBe(0);
		expect(projection!.ambiguous).toBe(false);
	});

	it('respects route direction when the shape is reversed', () => {
		const projection = projectPointOntoRoute(point(0.002), [...eastbound].reverse());
		expect(projection!.progress).toBeCloseTo(0.8, 4);
	});

	it('handles duplicate points when another usable segment remains', () => {
		const projection = projectPointOntoRoute(point(0.005), [point(0), point(0), point(0.01)]);
		expect(projection).toMatchObject({ segmentIndex: 1, ambiguous: false });
		expect(projection!.progress).toBeCloseTo(0.5, 4);
	});

	it.each([
		{ label: 'empty route', route: [] },
		{ label: 'one-point route', route: [point(0)] },
		{ label: 'zero-length route', route: [point(0), point(0)] },
	])('returns null for a $label', ({ route }) => {
		expect(projectPointOntoRoute(point(0), route)).toBeNull();
	});

	it('returns null for invalid coordinates instead of propagating NaN', () => {
		expect(projectPointOntoRoute({ lat: Number.NaN, lng: 0 }, eastbound)).toBeNull();
		expect(projectPointOntoRoute(point(0), [{ lat: 91, lng: 0 }, point(0.01)])).toBeNull();
	});

	it('rejects positions beyond the maximum route distance', () => {
		const projection = projectPointOntoRoute(point(0.005, 0.002), eastbound);
		expect(projection).toBeNull();
		expect(MAX_ROUTE_DISTANCE_METERS).toBe(150);
	});

	it('marks materially different projections onto an overlapping path as ambiguous', () => {
		const outAndBack = [point(0), point(0.01), point(0)];
		const projection = projectPointOntoRoute(point(0.005), outAndBack);

		expect(projection).not.toBeNull();
		expect(projection!.ambiguous).toBe(true);
		expect(AMBIGUITY_PROGRESS_GAP).toBe(0.08);
	});

	it('does not mistake adjacent segments meeting at a vertex for route ambiguity', () => {
		const corner = [point(0), point(0.005), point(0.005, 0.005)];
		const projection = projectPointOntoRoute(point(0.005), corner);
		expect(projection).toMatchObject({ ambiguous: false });
	});
});

describe('classifySameDirectionVehicles', () => {
	it('classifies upstream and just-past-tolerance vehicles as approaching', () => {
		const station = point(0.006);
		const result = classifySameDirectionVehicles(eastbound, station, [
			{ id: 'upstream', ...point(0.003) },
			{ id: 'gps-tolerance', ...point(0.0065) },
			{ id: 'passed', ...point(0.007) },
		]);

		expect(APPROACHING_TOLERANCE_METERS).toBe(75);
		expect(result.approaching.map(({ vehicle }) => vehicle.id)).toEqual([
			'upstream',
			'gps-tolerance',
		]);
		expect(result.passed.map(({ vehicle }) => vehicle.id)).toEqual(['passed']);
		expect(result.isConclusive).toBe(true);
	});

	it('keeps far-off vehicles visible but excludes them from route progress', () => {
		const vehicle = { id: 'off-route', ...point(0.005, 0.01) };
		const result = classifySameDirectionVehicles(eastbound, point(0.006), [vehicle]);

		expect(result.vehicles).toHaveLength(1);
		expect(result.offRoute).toEqual([{ vehicle, status: 'off-route', projection: null }]);
		expect(result.approaching).toEqual([]);
	});

	it('fails closed when the selected station has an ambiguous loop projection', () => {
		const result = classifySameDirectionVehicles(
			[point(0), point(0.01), point(0)],
			point(0.005),
			[{ id: 1, ...point(0.002) }]
		);

		expect(result.stationProjection?.ambiguous).toBe(true);
		expect(result.approaching).toEqual([]);
		expect(result.unclassified).toHaveLength(1);
		expect(result.isConclusive).toBe(false);
	});

	it('does not let one ambiguous crossing vehicle produce a no-vehicle claim', () => {
		const crossingRoute = [point(0), point(0.01), point(0.005, -0.01), point(0.005, 0.01)];
		const result = classifySameDirectionVehicles(crossingRoute, point(0.009), [
			{ id: 'crossing', ...point(0.005) },
		]);

		expect(result.ambiguous.map(({ vehicle }) => vehicle.id)).toEqual(['crossing']);
		expect(result.approaching).toEqual([]);
		expect(result.isConclusive).toBe(false);
	});

	it('is conclusive for a valid station and an empty fleet', () => {
		const result = classifySameDirectionVehicles(eastbound, point(0.006), []);
		expect(result.isConclusive).toBe(true);
		expect(result.vehicles).toEqual([]);
	});

	it('fails closed for an off-route station', () => {
		const result = classifySameDirectionVehicles(eastbound, point(0.006, 0.01), [
			{ id: 1, ...point(0.003) },
		]);
		expect(result.stationProjection).toBeNull();
		expect(result.unclassified).toHaveLength(1);
		expect(result.isConclusive).toBe(false);
	});
});

describe('opposite-direction turnaround helpers', () => {
	it('identifies whether the selected station is within the first 15% of its route', () => {
		expect(NEAR_ROUTE_END_FRACTION).toBe(0.15);
		expect(isPointNearRouteOrigin(point(0.0014), eastbound)).toBe(true);
		expect(isPointNearRouteOrigin(point(0.0016), eastbound)).toBe(false);
		expect(isPointNearRouteOrigin(point(0.005), [point(0), point(0.01), point(0)])).toBe(false);
	});

	it('labels opposite-route vehicles in the final 15% as possible turnarounds', () => {
		const result = classifyOppositeTurnaroundVehicles(eastbound, [
			{ id: 'candidate', ...point(0.009) },
			{ id: 'not-yet', ...point(0.0084) },
			{ id: 'off-route', ...point(0.009, 0.01) },
		]);

		expect(result.candidates.map(({ vehicle }) => vehicle.id)).toEqual(['candidate']);
		expect(result.others.map(({ vehicle }) => vehicle.id)).toEqual(['not-yet']);
		expect(result.offRoute.map(({ vehicle }) => vehicle.id)).toEqual(['off-route']);
		expect(result.isConclusive).toBe(true);
	});

	it('fails closed for ambiguous opposite-route projections', () => {
		const result = classifyOppositeTurnaroundVehicles(
			[point(0), point(0.01), point(0)],
			[{ id: 'loop', ...point(0.005) }]
		);

		expect(result.candidates).toEqual([]);
		expect(result.ambiguous).toHaveLength(1);
		expect(result.isConclusive).toBe(false);
	});
});
