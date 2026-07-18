import type { RoutePoint } from '../api/types.js';

/** A coordinate compatible with route points and live vehicle positions. */
export type GeoPoint = RoutePoint;

export interface RouteProjection {
	/** Progress through the directed route, from origin (0) to destination (1). */
	progress: number;
	distanceAlongRouteMeters: number;
	distanceFromRouteMeters: number;
	segmentIndex: number;
	/** Multiple similarly close route segments map this point to materially different progress. */
	ambiguous: boolean;
}

export type VehicleRouteStatus =
	| 'approaching'
	| 'passed'
	| 'off-route'
	| 'ambiguous'
	| 'unclassified';

export interface ClassifiedVehicle<T extends GeoPoint> {
	vehicle: T;
	status: VehicleRouteStatus;
	projection: RouteProjection | null;
}

export interface SameDirectionVehicleResult<T extends GeoPoint> {
	stationProjection: RouteProjection | null;
	vehicles: ClassifiedVehicle<T>[];
	approaching: ClassifiedVehicle<T>[];
	passed: ClassifiedVehicle<T>[];
	offRoute: ClassifiedVehicle<T>[];
	ambiguous: ClassifiedVehicle<T>[];
	unclassified: ClassifiedVehicle<T>[];
	/** False means absence of an approaching vehicle must not trigger an opposite-direction claim. */
	isConclusive: boolean;
}

export interface OppositeTurnaroundVehicleResult<T extends GeoPoint> {
	vehicles: ClassifiedVehicle<T>[];
	candidates: ClassifiedVehicle<T>[];
	others: ClassifiedVehicle<T>[];
	offRoute: ClassifiedVehicle<T>[];
	ambiguous: ClassifiedVehicle<T>[];
	/** False means no safe claim can be made about absence of turnaround candidates. */
	isConclusive: boolean;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const MIN_SEGMENT_LENGTH_METERS = 0.01;

/** Points farther away are treated as unrelated GPS positions. */
export const MAX_ROUTE_DISTANCE_METERS = 150;
/** Accounts for GPS/shape offsets around the selected stop without claiming a clearly passed vehicle. */
export const APPROACHING_TOLERANCE_METERS = 75;
/** Similar-distance projections are compared to detect overlapping or looping shapes. */
export const AMBIGUITY_DISTANCE_TOLERANCE_METERS = 20;
export const AMBIGUITY_ALONG_ROUTE_GAP_METERS = 25;
export const AMBIGUITY_PROGRESS_GAP = 0.08;
/** First/last 15% of the respective directed route. */
export const NEAR_ROUTE_END_FRACTION = 0.15;

interface SegmentProjection {
	segmentIndex: number;
	distanceAlongRouteMeters: number;
	distanceFromRouteMeters: number;
}

function isValidPoint(point: GeoPoint): boolean {
	return (
		Number.isFinite(point.lat) &&
		Number.isFinite(point.lng) &&
		point.lat >= -90 &&
		point.lat <= 90 &&
		point.lng >= -180 &&
		point.lng <= 180
	);
}

function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function distanceMeters(a: GeoPoint, b: GeoPoint): number {
	const meanLatitude = toRadians((a.lat + b.lat) / 2);
	const x = toRadians(b.lng - a.lng) * Math.cos(meanLatitude);
	const y = toRadians(b.lat - a.lat);
	return Math.hypot(x, y) * EARTH_RADIUS_METERS;
}

function projectOntoSegment(
	point: GeoPoint,
	start: GeoPoint,
	end: GeoPoint,
	segmentIndex: number,
	distanceAtStart: number,
	segmentLength: number
): SegmentProjection {
	const referenceLatitude = toRadians((point.lat + start.lat + end.lat) / 3);
	const startX = toRadians(start.lng - point.lng) * Math.cos(referenceLatitude) * EARTH_RADIUS_METERS;
	const startY = toRadians(start.lat - point.lat) * EARTH_RADIUS_METERS;
	const endX = toRadians(end.lng - point.lng) * Math.cos(referenceLatitude) * EARTH_RADIUS_METERS;
	const endY = toRadians(end.lat - point.lat) * EARTH_RADIUS_METERS;
	const segmentX = endX - startX;
	const segmentY = endY - startY;
	const squaredLength = segmentX * segmentX + segmentY * segmentY;
	const rawProgress = -(startX * segmentX + startY * segmentY) / squaredLength;
	const segmentProgress = Math.max(0, Math.min(1, rawProgress));
	const projectedX = startX + segmentX * segmentProgress;
	const projectedY = startY + segmentY * segmentProgress;

	return {
		segmentIndex,
		distanceAlongRouteMeters: distanceAtStart + segmentLength * segmentProgress,
		distanceFromRouteMeters: Math.hypot(projectedX, projectedY),
	};
}

/**
 * Project a coordinate onto a directed route.
 *
 * Returns null for invalid/degenerate paths and points over 150 m from the route.
 */
export function projectPointOntoRoute(point: GeoPoint, route: readonly GeoPoint[]): RouteProjection | null {
	if (!isValidPoint(point) || route.length < 2 || route.some((routePoint) => !isValidPoint(routePoint))) {
		return null;
	}

	const segmentLengths: number[] = [];
	let totalLength = 0;
	for (let index = 0; index < route.length - 1; index += 1) {
		const length = distanceMeters(route[index], route[index + 1]);
		segmentLengths.push(length);
		totalLength += length;
	}
	if (totalLength < MIN_SEGMENT_LENGTH_METERS) return null;

	const candidates: SegmentProjection[] = [];
	let distanceAtStart = 0;
	for (let index = 0; index < segmentLengths.length; index += 1) {
		const length = segmentLengths[index];
		if (length >= MIN_SEGMENT_LENGTH_METERS) {
			candidates.push(
				projectOntoSegment(point, route[index], route[index + 1], index, distanceAtStart, length)
			);
		}
		distanceAtStart += length;
	}
	if (candidates.length === 0) return null;

	let best = candidates[0];
	for (const candidate of candidates.slice(1)) {
		if (candidate.distanceFromRouteMeters < best.distanceFromRouteMeters) best = candidate;
	}
	if (best.distanceFromRouteMeters > MAX_ROUTE_DISTANCE_METERS) return null;

	const bestProgress = best.distanceAlongRouteMeters / totalLength;
	const ambiguous = candidates.some((candidate) => {
		if (candidate === best) return false;
		if (
			candidate.distanceFromRouteMeters >
			best.distanceFromRouteMeters + AMBIGUITY_DISTANCE_TOLERANCE_METERS
		) {
			return false;
		}
		const distanceGap = Math.abs(candidate.distanceAlongRouteMeters - best.distanceAlongRouteMeters);
		const progressGap = Math.abs(candidate.distanceAlongRouteMeters / totalLength - bestProgress);
		return (
			distanceGap >= AMBIGUITY_ALONG_ROUTE_GAP_METERS && progressGap >= AMBIGUITY_PROGRESS_GAP
		);
	});

	return {
		progress: bestProgress,
		distanceAlongRouteMeters: best.distanceAlongRouteMeters,
		distanceFromRouteMeters: best.distanceFromRouteMeters,
		segmentIndex: best.segmentIndex,
		ambiguous,
	};
}

function makeVehicleResult<T extends GeoPoint>(
	vehicle: T,
	status: VehicleRouteStatus,
	projection: RouteProjection | null
): ClassifiedVehicle<T> {
	return { vehicle, status, projection };
}

/** Classify live vehicles against a stop on the same directed route. */
export function classifySameDirectionVehicles<T extends GeoPoint>(
	route: readonly GeoPoint[],
	station: GeoPoint,
	vehicles: readonly T[]
): SameDirectionVehicleResult<T> {
	const stationProjection = projectPointOntoRoute(station, route);
	const stationIsUsable = stationProjection !== null && !stationProjection.ambiguous;
	const classified = vehicles.map((vehicle): ClassifiedVehicle<T> => {
		const projection = projectPointOntoRoute(vehicle, route);
		if (!projection) return makeVehicleResult(vehicle, 'off-route', null);
		if (!stationIsUsable) return makeVehicleResult(vehicle, 'unclassified', projection);
		if (projection.ambiguous) return makeVehicleResult(vehicle, 'ambiguous', projection);
		const isApproaching =
			projection.distanceAlongRouteMeters <=
			stationProjection.distanceAlongRouteMeters + APPROACHING_TOLERANCE_METERS;
		return makeVehicleResult(vehicle, isApproaching ? 'approaching' : 'passed', projection);
	});

	const byStatus = (status: VehicleRouteStatus) => classified.filter((item) => item.status === status);
	const ambiguous = byStatus('ambiguous');
	const unclassified = byStatus('unclassified');
	return {
		stationProjection,
		vehicles: classified,
		approaching: byStatus('approaching'),
		passed: byStatus('passed'),
		offRoute: byStatus('off-route'),
		ambiguous,
		unclassified,
		isConclusive: stationIsUsable && ambiguous.length === 0 && unclassified.length === 0,
	};
}

/** True only when the point has a unique on-route projection in the route's first 15%. */
export function isPointNearRouteOrigin(point: GeoPoint, route: readonly GeoPoint[]): boolean {
	const projection = projectPointOntoRoute(point, route);
	return projection !== null && !projection.ambiguous && projection.progress <= NEAR_ROUTE_END_FRACTION;
}

/**
 * On the opposite directed route, vehicles in its final 15% are possible turnarounds.
 * They are candidates, never promised continuations or ETAs.
 */
export function classifyOppositeTurnaroundVehicles<T extends GeoPoint>(
	route: readonly GeoPoint[],
	vehicles: readonly T[]
): OppositeTurnaroundVehicleResult<T> {
	const classified = vehicles.map((vehicle): ClassifiedVehicle<T> => {
		const projection = projectPointOntoRoute(vehicle, route);
		if (!projection) return makeVehicleResult(vehicle, 'off-route', null);
		if (projection.ambiguous) return makeVehicleResult(vehicle, 'ambiguous', projection);
		return makeVehicleResult(
			vehicle,
			projection.progress >= 1 - NEAR_ROUTE_END_FRACTION ? 'approaching' : 'passed',
			projection
		);
	});

	const byStatus = (status: VehicleRouteStatus) => classified.filter((item) => item.status === status);
	const ambiguous = byStatus('ambiguous');
	return {
		vehicles: classified,
		candidates: byStatus('approaching'),
		others: byStatus('passed'),
		offRoute: byStatus('off-route'),
		ambiguous,
		isConclusive: ambiguous.length === 0,
	};
}
