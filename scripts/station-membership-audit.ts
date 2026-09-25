import { decodeStopMemberships, type StbStopMemberships } from '../src/lib/api/topology.ts';
import { normalizeTransportType } from '../src/lib/api/transport.ts';
import { transitDay } from './transit-day.ts';
import { SUBWAY_STOP_IDS } from '../src/lib/stations/subway-stops.ts';
import { CollectionError, issueFrom, sha256, type Collector, type Issue, type ResponseEvidence, type TopologySnapshot } from './catalog-collection.ts';

export interface AuditStation {
	id: number;
	name: string;
	lines?: string[];
	lineIds?: number[];
	apiStopIds?: number[];
}
export interface AuditCatalog {
	stations: AuditStation[];
	stb?: { lineIds: number[] };
}
export interface MembershipDiscrepancy {
	code: 'missing-membership' | 'missing-catalog-stop' | 'topology-contradiction';
	apiStopId: number;
	stationId: number | null;
	stationName: string;
	lineId?: number;
	lineName?: string;
	rawType?: string;
	canonicalType?: string;
	directionId?: 0 | 1;
	comparison?: 'stb-id' | 'canonical-key';
}
export interface StopAuditResult {
	apiStopId: number;
	markerIds: number[];
	status: 'verified' | 'unverified';
	name?: string;
	lines?: StbStopMemberships['lines'];
	issues: Issue[];
}
export interface MembershipAuditReport {
	schemaVersion: 1;
	source?: string;
	catalogHash: string;
	snapshotHash?: string;
	status: 'conform' | 'nonconform' | 'inconclusive';
	inventoryScope: 'catalog-and-topology' | 'catalog-only';
	startedAt: string;
	completedAt: string;
	coverage: {
		catalogMarkers: number;
		verifiedMarkers: number;
		unverifiedMarkers: number;
		knownApiStops: number;
		requested: number;
		verified: number;
		unverified: number;
	};
	unmappedMarkers: Array<{ stationId: number; name: string; reason: string }>;
	stops: StopAuditResult[];
	discrepancies: MembershipDiscrepancy[];
	issues: Issue[];
	evidence: ResponseEvidence[];
}

function validateId(id: number): void {
	if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid catalog/API stop ID ${id}`);
}

/** Stable identities are authoritative only for lines declared in the STB catalog version. */
function serves(station: AuditStation, line: StbStopMemberships['lines'][number], authoritative: Set<number>): boolean {
	if (authoritative.has(line.id)) return station.lineIds?.includes(line.id) ?? false;
	return (station.lines ?? []).some((key) => {
		const separator = key.indexOf(':');
		return separator > 0 && normalizeTransportType(key.slice(0, separator)) === line.type &&
			key.slice(separator + 1).trim().toUpperCase() === line.name.trim().toUpperCase();
	});
}

/**
 * Visit the union of every known API stop, including topology-only discoveries.
 * Positive responses identify missing memberships; missing arrivals never remove one.
 */
export async function auditStationMembership(
	collector: Pick<Collector, 'get' | 'evidence' | 'startedAt' | 'now' | 'progress'> & { source?: string },
	catalog: AuditCatalog,
	snapshot?: TopologySnapshot
): Promise<MembershipAuditReport> {
	const report: MembershipAuditReport = {
		schemaVersion: 1, source: collector.source, catalogHash: sha256(JSON.stringify(catalog)),
		snapshotHash: snapshot ? sha256(JSON.stringify(snapshot)) : undefined,
		status: 'inconclusive', inventoryScope: snapshot ? 'catalog-and-topology' : 'catalog-only',
		startedAt: collector.startedAt, completedAt: '',
		coverage: { catalogMarkers: catalog.stations.length, verifiedMarkers: 0, unverifiedMarkers: 0, knownApiStops: 0, requested: 0, verified: 0, unverified: 0 },
		unmappedMarkers: [], stops: [], discrepancies: [], issues: [], evidence: []
	};
	const targets = new Map<number, AuditStation[]>();
	const markerTargets = new Map<number, number[]>();
	const authoritative = new Set(catalog.stb?.lineIds ?? []);
	const registered = new Set(snapshot?.registry.map((line) => line.id));
	const topology = new Map(snapshot?.lines.map((line) => [line.id, line]));
	for (const id of authoritative) validateId(id);
	for (const station of catalog.stations) {
		validateId(station.id);
		if (markerTargets.has(station.id)) throw new Error(`Duplicate catalog marker ${station.id}`);
		const subway = station.lines?.some((key) => normalizeTransportType(key.split(':')[0]) === 'SUBWAY');
		const ids = station.apiStopIds ?? SUBWAY_STOP_IDS[station.id] ?? (subway ? [] : [station.id]);
		const uniqueIds = [...new Set(ids)];
		markerTargets.set(station.id, uniqueIds);
		if (!uniqueIds.length) {
			report.unmappedMarkers.push({ stationId: station.id, name: station.name, reason: 'No verified API platform mapping' });
		}
		for (const id of uniqueIds) {
			validateId(id);
			const markers = targets.get(id) ?? [];
			markers.push(station);
			targets.set(id, markers);
		}
	}
	if (snapshot) {
		if (snapshot.status !== 'complete') {
			report.issues.push({ code: 'incomplete-inventory', path: 'topology', message: 'Topology snapshot is inconclusive; inventory may be incomplete' });
		}
		const stopNames = new Map(snapshot.stops.map((stop) => [stop.id, stop.name]));
		// Include edge-only IDs too: an inconsistent source must not shrink the denominator.
		const ids = new Set([...stopNames.keys(), ...snapshot.lines.flatMap((line) => [
			...line.allStopIds, ...line.directions['0'], ...line.directions['1']
		])]);
		for (const id of ids) {
			validateId(id);
			if (!targets.has(id)) {
				targets.set(id, []);
				report.discrepancies.push({ code: 'missing-catalog-stop', apiStopId: id, stationId: null, stationName: stopNames.get(id) ?? `API stop ${id}` });
			}
		}
	}
	if (!targets.size) report.issues.push({ code: 'empty-inventory', path: 'catalog', message: 'No known API stops to audit' });
	report.coverage.knownApiStops = targets.size;
	let stopped: Issue | undefined;
	const visitedPaths = new Set<string>();
	const sortedTargets = [...targets].sort(([a], [b]) => a - b);
	for (const [index, [apiStopId, markers]] of sortedTargets.entries()) {
		const path = `/lines/stop?stop_id=${apiStopId}`;
		const result: StopAuditResult = { apiStopId, markerIds: markers.map((station) => station.id), status: 'unverified', issues: [] };
		report.stops.push(result);
		if (stopped) {
			result.issues.push({ code: 'not-requested', path, message: `Collection stopped after ${stopped.code}: ${stopped.message}` });
			continue;
		}
		collector.progress?.(`Membership ${index + 1}/${sortedTargets.length}: ${apiStopId}`);
		report.coverage.requested++;
		visitedPaths.add(path);
		try {
			const response = decodeStopMemberships(await collector.get(path), apiStopId);
			result.name = response.name;
			result.lines = response.lines;
			if (!response.lines.length) result.issues.push({ code: 'no-memberships', path, message: 'Named stop returned no lines; membership is unverified' });
			const seen = new Set<string>();
			for (const line of response.lines) {
				if (snapshot && !registered.has(line.id)) {
					result.issues.push({ code: 'unregistered-line', path, message: `Observed line ${line.id} (${line.name}, ${line.rawType}) is absent from the topology registry` });
				} else if (snapshot && !topology.get(line.id)?.directions[line.directionId].includes(apiStopId)) {
					const pair = `topology:${line.id}:${line.directionId}`;
					if (!seen.has(pair)) {
						seen.add(pair);
						report.discrepancies.push({
							code: 'topology-contradiction', apiStopId, stationId: null, stationName: response.name,
							lineId: line.id, lineName: line.name, rawType: line.rawType,
							canonicalType: line.type, directionId: line.directionId
						});
					}
				}
				if (!line.type) {
					result.issues.push({ code: 'unknown-type', path, message: `Line ${line.id} (${line.name}): ${line.rawType}` });
					continue;
				}
				for (const station of markers) {
					const pair = `${station.id}:${line.id}:${line.directionId}`;
					if (seen.has(pair) || serves(station, line, authoritative)) continue;
					seen.add(pair);
					report.discrepancies.push({
						code: 'missing-membership', apiStopId, stationId: station.id, stationName: response.name,
						lineId: line.id, lineName: line.name, rawType: line.rawType, canonicalType: line.type,
						directionId: line.directionId, comparison: authoritative.has(line.id) ? 'stb-id' : 'canonical-key'
					});
				}
			}
			if (!result.issues.length) result.status = 'verified';
		} catch (error) {
			const issue = issueFrom(error, path);
			result.issues.push(issue);
			if (error instanceof CollectionError && ['auth', 'budget'].includes(error.code)) stopped = issue;
		}
	}
	const verifiedIds = new Set(report.stops.filter((result) => result.status === 'verified').map((result) => result.apiStopId));
	report.coverage.verified = verifiedIds.size;
	report.coverage.unverified = targets.size - verifiedIds.size;
	report.coverage.verifiedMarkers = [...markerTargets.values()].filter((ids) => ids.length && ids.every((id) => verifiedIds.has(id))).length;
	report.coverage.unverifiedMarkers = catalog.stations.length - report.coverage.verifiedMarkers;
	report.evidence = [...collector.evidence.values()].filter((entry) => visitedPaths.has(entry.path));
	report.startedAt = [report.startedAt, ...report.evidence.map((entry) => entry.capturedAt)].sort()[0];
	report.completedAt = new Date(collector.now()).toISOString();
	if (transitDay(Date.parse(report.startedAt)) !== transitDay(Date.parse(report.completedAt))) {
		report.issues.push({ code: 'transit-day-changed', path: 'collection', message: 'Audit crossed the 04:00 Europe/Bucharest service boundary' });
	}
	report.status = report.coverage.unverified || report.unmappedMarkers.length || report.issues.length ? 'inconclusive'
		: report.discrepancies.length ? 'nonconform' : 'conform';
	return report;
}

const cell = (value: unknown): string => String(value ?? '—').replace(/[|\r\n]/g, ' ');

export function formatMembershipAuditMarkdown(report: MembershipAuditReport): string {
	const coverage = report.coverage;
	const rows = [
		'# Station membership audit', '',
		`Status: **${report.status}**. Inventory: ${report.inventoryScope}.`,
		`Observation interval: ${report.startedAt} – ${report.completedAt}.`, '',
		`API stops: ${coverage.knownApiStops} known; ${coverage.requested} requested; ${coverage.verified} verified; ${coverage.unverified} unverified.`,
		`Catalog markers: ${coverage.catalogMarkers}; ${coverage.verifiedMarkers} verified; ${coverage.unverifiedMarkers} unverified.`, '',
		'“Verified” means a named response with known transport types and positive line evidence; it does not prove the absence of any other line.',
		'Inventory covers known catalog/platform IDs and supplied topology IDs. Stops absent from every source remain undiscoverable.',
		'An absent arrival never removes a station or membership. JSON includes exact observations and response hashes.', '',
		'## Discrepancies', '',
		'| Issue | API stop | Marker | Station | Line ID | Line | Raw type | Direction | Comparison |',
		'|---|---|---|---|---|---|---|---|---|',
		...report.discrepancies.map((item) => `| ${[item.code, item.apiStopId, item.stationId, item.stationName, item.lineId, item.lineName, item.rawType, item.directionId, item.comparison].map(cell).join(' | ')} |`),
		'', '## Unverified markers', '',
		...report.unmappedMarkers.map((item) => `- ${item.stationId} (${cell(item.name)}): ${item.reason}`),
		'', '## Issues', '',
		...[...report.issues, ...report.stops.flatMap((result) => result.issues)].map((issue) => `- ${cell(issue.code)} ${cell(issue.path)}: ${cell(issue.message)}`), ''
	];
	return rows.join('\n');
}
