import { sha256, type TopologySnapshot, type ResponseEvidence } from './catalog-collection.ts';
import type { StbStationCatalog } from './stb-catalog.ts';
import type { MembershipAuditReport } from './station-membership-audit.ts';
import { normalizeTransportType } from '../src/lib/api/transport.ts';
import { SUBWAY_STOP_IDS } from '../src/lib/stations/subway-stops.ts';
import { hasValidStationCoordinates, stationServesLine, validateStations } from '../src/lib/stations/membership.ts';
import { findStationsInBounds } from '../src/lib/stations/geo.ts';
import { transitDay } from './transit-day.ts';

function fail(message: string): never { throw new Error(`Catalog verification: ${message}`); }
const sameIds = (a: Iterable<number>, b: Iterable<number>): boolean => {
	const first = new Set(a), second = new Set(b);
	return first.size === second.size && [...first].every((id) => second.has(id));
};
export const snapshotHash = (snapshot: TopologySnapshot): string => sha256(JSON.stringify(snapshot));
export const catalogHash = (catalog: StbStationCatalog): string => sha256(JSON.stringify(catalog));

export interface CatalogVerificationReport {
	status: 'conform';
	snapshotHash: string;
	catalogHash: string;
	lines: number;
	directions: number;
	sourceStops: number;
	markers: number;
	directionEdges: number;
	markerMemberships: number;
}

/** Independent source oracle, exercised through the application's loader, matcher and map filter. */
export function verifyStbCatalog(snapshot: TopologySnapshot, catalog: StbStationCatalog): CatalogVerificationReport {
	if (snapshot.status !== 'complete' || snapshot.schemaVersion !== 1 || snapshot.issues.length) fail('source snapshot is incomplete');
	if (catalog.schemaVersion !== 2 || !catalog.stb) fail('catalog lacks STB provenance');
	if (catalog.stb.source !== snapshot.source || catalog.stb.observedAt !== snapshot.completedAt) fail('catalog source observation differs');
	const registry = new Map(snapshot.registry.map((line) => [line.id, line]));
	if (!registry.size || registry.size !== snapshot.registry.length) fail('empty/duplicate source registry');
	if (!sameIds(registry.keys(), catalog.stb.lineIds) || new Set(catalog.stb.lineIds).size !== catalog.stb.lineIds.length) fail('catalog registry differs');
	for (const line of registry.values()) {
		if (!Number.isSafeInteger(line.id) || line.id <= 0 || !line.name.trim() || !line.type || normalizeTransportType(line.rawType) !== line.type) fail(`invalid line ${line.id}`);
	}
	const sourceStops = new Map(snapshot.stops.map((stop) => [stop.id, stop]));
	if (sourceStops.size !== snapshot.stops.length) fail('duplicate source stop');
	for (const stop of sourceStops.values()) {
		if (!Number.isSafeInteger(stop.id) || stop.id <= 0 || !stop.name.trim() || !hasValidStationCoordinates(stop)) fail(`invalid source stop ${stop.id}`);
	}
	const sourceLines = new Map(snapshot.lines.map((line) => [line.id, line]));
	if (sourceLines.size !== snapshot.lines.length || !sameIds(registry.keys(), sourceLines.keys())) fail('source registry/topology differs');
	const loaded = validateStations(catalog.stations);
	if (loaded.length !== catalog.stations.length) fail('runtime drops invalid catalog coordinates');
	const markers = new Map(loaded.map((station) => [station.id, station]));
	if (markers.size !== loaded.length) fail('duplicate catalog marker');
	const parentsByPlatform = new Map<number, number[]>();
	for (const [parent, platforms] of Object.entries(SUBWAY_STOP_IDS)) {
		for (const platform of platforms) parentsByPlatform.set(platform, [...(parentsByPlatform.get(platform) ?? []), Number(parent)]);
	}
	const expectedMemberships = new Map<number, Set<number>>();
	const expectedPlatforms = new Map<number, Set<number>>();
	const sourceUsed = new Set<number>();
	let directionEdges = 0;
	const authoritative = new Set(registry.keys());
	for (const [id, topology] of sourceLines) {
		const line = registry.get(id)!;
		const selection = { lineId: id, lineName: line.name, vehicleType: line.rawType };
		const union = new Set([...topology.directions[0], ...topology.directions[1]]);
		if (!sameIds(union, topology.allStopIds)) fail(`source direction union differs for ${id}`);
		const priority = new Set(loaded.filter((station) => stationServesLine(station, selection, authoritative)).map((station) => station.id));
		// At least 101 background markers exercise the real density cap even in tiny fixtures.
		const background = Array.from({ length: 101 }, (_, index) => ({ id: -index - 1, name: 'verification background', description: '', lat: 0, lon: 0 }));
		const visible = new Set(findStationsInBounds({ south: -90, north: 90, west: -180, east: 180 }, [...loaded, ...background], 100, null, priority).map((station) => station.id));
		for (const direction of [0, 1] as const) {
			if (!topology.directions[direction]?.length) fail(`empty direction ${id}/${direction}`);
			for (const stopId of topology.directions[direction]) {
				directionEdges++;
				sourceUsed.add(stopId);
				const source = sourceStops.get(stopId);
				if (!source) fail(`unresolved source stop ${stopId}`);
				const parents = line.type === 'SUBWAY' ? parentsByPlatform.get(stopId) : undefined;
				for (const markerId of parents ?? [stopId]) {
					const marker = markers.get(markerId);
					if (!marker || !visible.has(markerId)) fail(`missing rendered edge ${id}/${direction}/${stopId} -> ${markerId}`);
					if (!parents && (marker.lat !== source.lat || marker.lon !== source.lon)) fail(`source coordinates differ for ${stopId}`);
					const memberships = expectedMemberships.get(markerId) ?? new Set<number>();
					memberships.add(id); expectedMemberships.set(markerId, memberships);
					const platforms = expectedPlatforms.get(markerId) ?? new Set<number>();
					platforms.add(stopId); expectedPlatforms.set(markerId, platforms);
				}
			}
		}
	}
	if (!sameIds(sourceUsed, sourceStops.keys())) fail('source includes unreferenced stops');
	for (const marker of loaded) {
		if (!Number.isSafeInteger(marker.id) || marker.id <= 0 || !marker.name.trim()) fail(`invalid catalog marker ${marker.id}`);
		const expected = expectedMemberships.get(marker.id) ?? new Set<number>();
		if (!sameIds(marker.lineIds ?? [], expected) || new Set(marker.lineIds).size !== (marker.lineIds ?? []).length) fail(`extra/missing membership at marker ${marker.id}`);
		if (expectedPlatforms.has(marker.id) && !sameIds(marker.apiStopIds ?? [], expectedPlatforms.get(marker.id)!)) fail(`platform resolution differs at marker ${marker.id}`);
	}
	const semantic = { feedVersion: catalog.feedVersion, sourceUpdatedAt: catalog.sourceUpdatedAt, lineIds: catalog.stb.lineIds, stations: catalog.stations };
	if (sha256(JSON.stringify(semantic)) !== catalog.stb.contentHash) fail('semantic content hash mismatch');
	return { status: 'conform', snapshotHash: snapshotHash(snapshot), catalogHash: catalogHash(catalog), lines: registry.size, directions: registry.size * 2, sourceStops: sourceStops.size, markers: markers.size, directionEdges, markerMemberships: [...expectedMemberships.values()].reduce((sum, ids) => sum + ids.size, 0) };
}

function edges(snapshot: TopologySnapshot): Set<string> {
	return new Set(snapshot.lines.flatMap((line) => ([0, 1] as const).flatMap((direction) => line.directions[direction].map((stop) => `${line.id}/${direction}/${stop}`))));
}

function validateEvidence(evidence: ResponseEvidence[], paths: string[], earliest: number, latest: number): void {
	const byPath = new Map(evidence.map((entry) => [entry.path, entry]));
	for (const path of paths) {
		const item = byPath.get(path), time = Date.parse(item?.capturedAt ?? '');
		if (!item || !/^[a-f\d]{64}$/.test(item.sha256) || !Number.isFinite(time) || time < earliest || time > latest) fail(`missing/stale source evidence ${path}`);
	}
}

function topologyPaths(snapshot: TopologySnapshot): string[] {
	return ['/lines?lang=ro', ...snapshot.registry.flatMap((line) => [`/lines/${line.id}?lang=ro`, ...[0, 1].map((direction) => `/lines/${line.id}/direction/${direction}?lang=ro`)])];
}

function validateConfirmationStructure(snapshot: TopologySnapshot): void {
	const ids = new Set(snapshot.registry.map((line) => line.id));
	const stops = new Set(snapshot.stops.map((stop) => stop.id));
	if (snapshot.schemaVersion !== 1 || !ids.size || ids.size !== snapshot.registry.length || snapshot.lines.length !== ids.size ||
		new Set(snapshot.lines.map((line) => line.id)).size !== ids.size || !sameIds(ids, snapshot.lines.map((line) => line.id)) ||
		stops.size !== snapshot.stops.length || snapshot.registry.some((line) => !line.type || normalizeTransportType(line.rawType) !== line.type) ||
		snapshot.stops.some((stop) => !Number.isSafeInteger(stop.id) || stop.id <= 0 || !stop.name.trim() || !hasValidStationCoordinates(stop))) fail('confirmation structure is incomplete');
	const referenced = new Set<number>();
	for (const line of snapshot.lines) {
		if (!line.directions[0]?.length || !line.directions[1]?.length) fail('confirmation has an empty direction');
		const union = new Set([...line.directions[0], ...line.directions[1]]);
		if (!sameIds(union, line.allStopIds) || [...union].some((id) => !stops.has(id))) fail('confirmation source edges are incomplete');
		for (const id of union) referenced.add(id);
	}
	if (!sameIds(referenced, stops)) fail('confirmation has unreferenced stops');
}

export interface PublicationOptions { now?: number; maxAgeMs?: number; reviewedBulkChange?: boolean }
export type BoundMembershipAudit = MembershipAuditReport;

/** Fails closed; this validates a publication request but never mutates the catalog. */
export function validatePublication(
	previous: TopologySnapshot | undefined,
	candidate: TopologySnapshot,
	confirmation: TopologySnapshot | undefined,
	audit: BoundMembershipAudit,
	catalog: StbStationCatalog,
	options: PublicationOptions = {}
): { addedEdges: number; removedEdges: number; changedLines: number } {
	verifyStbCatalog(candidate, catalog);
	const now = options.now ?? Date.now(), maxAge = options.maxAgeMs ?? 6 * 60 * 60_000;
	if (!Number.isFinite(now) || !Number.isFinite(maxAge) || maxAge <= 0) fail('invalid publication clock/freshness policy');
	const start = Date.parse(candidate.startedAt), end = Date.parse(candidate.completedAt);
	if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end > now || start < now - maxAge) fail('candidate observation is stale or invalid');
	if (transitDay(start) !== transitDay(now) || transitDay(end) !== transitDay(now)) fail('candidate belongs to another transit day');
	validateEvidence(candidate.evidence, topologyPaths(candidate), start, end);
	if (audit.snapshotHash !== snapshotHash(candidate) || audit.catalogHash !== catalogHash(catalog)) fail('audit belongs to another snapshot/catalog');
	if (audit.status !== 'conform' || audit.inventoryScope !== 'catalog-and-topology' || audit.discrepancies.length || audit.issues.length || audit.unmappedMarkers.length) fail('full live audit is not conform');
	const auditStart = Date.parse(audit.startedAt), auditEnd = Date.parse(audit.completedAt);
	if (!Number.isFinite(auditStart) || !Number.isFinite(auditEnd) || auditStart > auditEnd || auditStart < now - maxAge || auditEnd > now || Math.max(auditEnd, end) - Math.min(auditStart, start) > maxAge) fail('audit observation is stale or invalid');
	if (transitDay(auditStart) !== transitDay(now) || transitDay(auditEnd) !== transitDay(now)) fail('audit belongs to another transit day');
	const targets = new Set([...candidate.stops.map((stop) => stop.id), ...catalog.stations.flatMap((station) => station.apiStopIds ?? SUBWAY_STOP_IDS[station.id] ?? [station.id])]);
	const audited = new Set(audit.stops.map((stop) => stop.apiStopId));
	const coverage = audit.coverage;
	if (!sameIds(targets, audited) || audited.size !== audit.stops.length || audit.stops.some((stop) => stop.status !== 'verified' || stop.issues.length || !stop.lines?.length) ||
		coverage.knownApiStops !== targets.size || coverage.requested !== targets.size || coverage.verified !== targets.size || coverage.unverified !== 0 ||
		coverage.catalogMarkers !== catalog.stations.length || coverage.verifiedMarkers !== catalog.stations.length || coverage.unverifiedMarkers !== 0) fail('full audit coverage is incomplete');
	validateEvidence(audit.evidence, [...targets].map((id) => `/lines/stop?stop_id=${id}`), auditStart, auditEnd);
	if (previous && (previous.status !== 'complete' || previous.issues.length || previous.source !== candidate.source)) fail('previous source is not comparable');
	const old = previous ? edges(previous) : new Set<string>(), next = edges(candidate);
	const removed = [...old].filter((edge) => !next.has(edge));
	const added = [...next].filter((edge) => !old.has(edge));
	const changedLines = new Set([...removed, ...added].map((edge) => edge.split('/')[0])).size;
	if ((!previous || (removed.length + added.length) / Math.max(1, old.size) > 0.2) && !options.reviewedBulkChange) fail('initial migration or bulk change requires explicit review');
	if (removed.length) {
		if (!confirmation || confirmation.status !== 'complete' || confirmation.issues.length || confirmation.source !== candidate.source) fail('removals require a complete independent confirmation');
		validateConfirmationStructure(confirmation);
		const confirmationStart = Date.parse(confirmation.startedAt), confirmationEnd = Date.parse(confirmation.completedAt);
		if (!Number.isFinite(confirmationStart) || !Number.isFinite(confirmationEnd) || confirmationStart <= end || confirmationEnd < confirmationStart || confirmationEnd > now) fail('confirmation must be captured after the candidate');
		if (transitDay(confirmationStart) !== transitDay(now) || transitDay(confirmationEnd) !== transitDay(now)) fail('confirmation belongs to another transit day');
		validateEvidence(confirmation.evidence, topologyPaths(confirmation), confirmationStart, confirmationEnd);
		const confirmed = edges(confirmation);
		if (removed.some((edge) => confirmed.has(edge))) fail('deleted edge reappeared in confirmation');
		const removedLines = previous!.registry.filter((line) => !candidate.registry.some((item) => item.id === line.id));
		if (removedLines.some((line) => confirmation.registry.some((item) => item.id === line.id))) fail('removed line reappeared in confirmation registry');
	}
	return { addedEdges: added.length, removedEdges: removed.length, changedLines };
}
