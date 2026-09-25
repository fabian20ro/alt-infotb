import { createHash } from 'node:crypto';
import type { TopologySnapshot } from './catalog-collection.ts';
import type { StationCatalog } from './station-catalog.ts';
import type { Station } from '../src/lib/stations/types.ts';
import { SUBWAY_STOP_IDS } from '../src/lib/stations/subway-stops.ts';
import { hasValidStationCoordinates } from '../src/lib/stations/membership.ts';
import { normalizeTransportType } from '../src/lib/api/transport.ts';

export interface StbStationCatalog extends StationCatalog {
	schemaVersion: 2;
	stb: { source: string; observedAt: string; contentHash: string; lineIds: number[] };
	stations: Station[];
}

function fail(message: string): never { throw new Error(`STB catalog: ${message}`); }

/** Compose fresh GTFS data with a complete STB snapshot; never reuse a prior composition as GTFS. */
export function buildStbCatalog(base: StationCatalog, snapshot: TopologySnapshot): StbStationCatalog {
	if ('schemaVersion' in base && base.schemaVersion === 2) fail('base must be a fresh GTFS catalog');
	if (snapshot.schemaVersion !== 1 || snapshot.status !== 'complete' || snapshot.issues.length) {
		fail('incomplete or invalid source snapshot');
	}
	if (!snapshot.registry.length || !Number.isFinite(Date.parse(snapshot.completedAt))) fail('missing registry or observation date');
	const registry = new Map(snapshot.registry.map((line) => [line.id, line]));
	if (registry.size !== snapshot.registry.length) fail('duplicate registry line IDs');
	const authoritativeKeys = new Set<string>();
	for (const line of registry.values()) {
		if (!Number.isSafeInteger(line.id) || line.id <= 0 || !line.name.trim()) fail('invalid line identity');
		if (!line.type || line.type !== normalizeTransportType(line.rawType)) fail(`unknown or inconsistent transport type for line ${line.id}`);
		authoritativeKeys.add(`${line.type}:${line.name.trim()}`);
	}
	const sourceStops = new Map(snapshot.stops.map((stop) => [stop.id, stop]));
	if (sourceStops.size !== snapshot.stops.length) fail('duplicate source stop IDs');
	for (const stop of sourceStops.values()) {
		if (!Number.isSafeInteger(stop.id) || stop.id <= 0 || !stop.name.trim() || !hasValidStationCoordinates(stop)) {
			fail(`invalid source stop ${stop.id}`);
		}
	}
	const sourceLines = new Map(snapshot.lines.map((line) => [line.id, line]));
	if (sourceLines.size !== snapshot.lines.length || sourceLines.size !== registry.size) fail('registry/topology line coverage differs');
	const memberships = new Map<number, Set<number>>();
	for (const [id, topology] of sourceLines) {
		if (!registry.has(id)) fail(`unregistered line ${id}`);
		const union = new Set<number>();
		for (const direction of ['0', '1'] as const) {
			if (!topology.directions[direction]?.length) fail(`empty direction ${id}/${direction}`);
			for (const stopId of topology.directions[direction]) union.add(stopId);
		}
		const all = new Set(topology.allStopIds);
		if (all.size !== union.size || [...union].some((stopId) => !all.has(stopId))) fail(`direction union differs for line ${id}`);
		for (const stopId of union) {
			if (!sourceStops.has(stopId)) fail(`unresolved stop ${stopId} on line ${id}`);
			const lines = memberships.get(stopId) ?? new Set<number>();
			lines.add(id);
			memberships.set(stopId, lines);
		}
	}

	const stations = new Map<number, Station>();
	for (const station of base.stations) {
		if (stations.has(station.id)) fail(`duplicate base marker ${station.id}`);
		const fallback = (station.lines ?? []).filter((key) => !authoritativeKeys.has(key));
		stations.set(station.id, { ...station, lines: [...new Set(fallback)].sort(), fallbackLines: [...new Set(fallback)].sort(), lineIds: [], membershipSource: 'gtfs' });
	}
	const parentsByPlatform = new Map<number, number[]>();
	for (const [parent, platforms] of Object.entries(SUBWAY_STOP_IDS)) {
		for (const platform of platforms) {
			const parents = parentsByPlatform.get(platform) ?? [];
			parents.push(Number(parent));
			parentsByPlatform.set(platform, parents);
		}
	}
	for (const [stopId, lineIds] of memberships) {
		const source = sourceStops.get(stopId)!;
		const subway = [...lineIds].some((id) => registry.get(id)!.type === 'SUBWAY');
		const surface = [...lineIds].some((id) => registry.get(id)!.type !== 'SUBWAY');
		if (subway && surface) fail(`ambiguous surface/subway source ID ${stopId}`);
		const parents = subway ? parentsByPlatform.get(stopId) : undefined;
		if (!subway && parentsByPlatform.has(stopId)) fail(`surface stop collides with metro platform ${stopId}`);
		const markerIds = parents ?? [stopId];
		for (const markerId of markerIds) {
			let marker = stations.get(markerId);
			if (parents && !marker) fail(`mapped metro parent ${markerId} missing from GTFS`);
			if (!parents && SUBWAY_STOP_IDS[markerId]) fail(`source stop collides with metro parent ${markerId}`);
			if (!marker) {
				marker = { id: markerId, name: source.name, description: '', lat: source.lat, lon: source.lon, lines: [], fallbackLines: [], lineIds: [], membershipSource: 'stb' };
				stations.set(markerId, marker);
			} else if (!parents) {
				// Surface station identities are shared; use coordinates and identity from the same live source.
				marker.name = source.name;
				marker.lat = source.lat;
				marker.lon = source.lon;
			}
			marker.apiStopIds = [...new Set([...(marker.apiStopIds ?? []), stopId])].sort((a, b) => a - b);
			marker.lineIds = [...new Set([...(marker.lineIds ?? []), ...lineIds])].sort((a, b) => a - b);
			marker.lines = [...new Set([...(marker.lines ?? []), ...[...lineIds].map((id) => {
				const line = registry.get(id)!;
				return `${line.type}:${line.name.trim()}`;
			})])].sort();
			marker.membershipSource = marker.lines.some((key) => !authoritativeKeys.has(key)) ? 'mixed' : 'stb';
		}
	}
	const sorted = [...stations.values()].sort((a, b) => a.id - b.id);
	if (sorted.some((station) => !hasValidStationCoordinates(station))) fail('invalid composed marker coordinates');
	const lineIds = [...registry.keys()].sort((a, b) => a - b);
	const semantic = { feedVersion: base.feedVersion, sourceUpdatedAt: base.sourceUpdatedAt, lineIds, stations: sorted };
	const contentHash = createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
	return {
		schemaVersion: 2,
		feedVersion: base.feedVersion,
		sourceUpdatedAt: base.sourceUpdatedAt,
		stb: { source: snapshot.source, observedAt: snapshot.completedAt, contentHash, lineIds },
		stations: sorted
	};
}
