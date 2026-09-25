import { sha256, type TopologySnapshot, type ResponseEvidence } from './catalog-collection.ts';
import type { MembershipAuditReport } from './station-membership-audit.ts';
import type { ServiceDiscoveryReport } from './service-discovery.ts';
import { inventoryCaptureId, type InventoryCapture, type InventoryObservation, type InventoryTopology } from './service-inventory.ts';

/** Translate independently hashed source artifacts into observations, never runtime memberships. */
export function createInventoryCapture(
	snapshot: TopologySnapshot,
	audit?: MembershipAuditReport,
	discovery?: ServiceDiscoveryReport
): InventoryCapture {
	const snapshotHash = sha256(JSON.stringify(snapshot));
	// The collector's final registry probe replaces its evidence-map entry. If the
	// registry changed, initial labels no longer match that body's hash/timestamp.
	const registry = snapshot.issues.some(issue => issue.code === 'registry-changed') ? [] : snapshot.registry;
	if (audit && (audit.snapshotHash !== snapshotHash || audit.source !== snapshot.source)) throw new Error('Audit/snapshot source or hash mismatch');
	if (discovery && (!audit || discovery.snapshotHash !== snapshotHash ||
		discovery.auditHash !== sha256(JSON.stringify(audit)) || discovery.catalogHash !== audit.catalogHash ||
		discovery.source !== snapshot.source)) throw new Error('Discovery/source artifact mismatch');
	const observations: InventoryObservation[] = [];
	const topology: InventoryTopology[] = [];
	function evidenceFor(evidence: ResponseEvidence[], path: string): ResponseEvidence {
		const entry = evidence.find((item) => item.path === path);
		if (!entry) throw new Error(`Missing observation evidence: ${path}`);
		return entry;
	}
	for (const report of [audit, discovery]) {
		if (!report) continue;
		for (const stop of report.stops) {
			if (!stop.lines?.length) continue;
			const evidence = evidenceFor(report.evidence, `/lines/stop?stop_id=${stop.apiStopId}`);
			for (const line of stop.lines) observations.push({
				id: line.id, name: line.name, rawType: line.rawType, apiStopId: stop.apiStopId, directionId: line.directionId, ...evidence
			});
		}
	}
	for (const line of registry) {
		const paths = [`/lines/${line.id}?lang=ro`, `/lines/${line.id}/direction/0?lang=ro`, `/lines/${line.id}/direction/1?lang=ro`];
		const evidence = snapshot.evidence.filter((entry) => paths.includes(entry.path));
		// An inconclusive registry snapshot cannot establish verified topology for a subset.
		const detail = snapshot.lines.find(item => item.id === line.id);
		const union = new Set([...(detail?.directions[0] ?? []), ...(detail?.directions[1] ?? [])]);
		const complete = snapshot.status === 'complete' && snapshot.issues.length === 0 && evidence.length === 3 &&
			detail?.directions[0].length && detail.directions[1].length && union.size === detail.allStopIds.length &&
			detail.allStopIds.every(id => union.has(id) && snapshot.stops.some(stop => stop.id === id));
		topology.push({ id: line.id, status: complete ? 'verified' : 'unresolved',
			issues: snapshot.issues.filter((issue) => paths.includes(issue.path) || issue.path === `line:${line.id}`), evidence });
	}
	for (const service of discovery?.services ?? []) {
		topology.push({ id: service.id, status: service.status === 'verified' ? 'verified' : 'unresolved',
			issues: service.issues, evidence: service.evidence });
		if (service.topology) {
			const evidence = evidenceFor(service.evidence, `/lines/${service.id}?lang=ro`);
			observations.push({ id: service.id, name: service.topology.name, rawType: service.topology.rawType, ...evidence });
		}
	}
	const reports = [snapshot, audit, discovery].filter((value) => value !== undefined);
	const input: Omit<InventoryCapture, 'captureId'> = {
		source: snapshot.source,
		assessment: {
			scope: audit ? 'registry-and-stops' : 'registry-only', snapshotHash,
			...(audit ? { auditHash: sha256(JSON.stringify(audit)), auditStatus: audit.status,
				knownStops: audit.coverage.knownApiStops, requestedStops: audit.coverage.requested } : {}),
			...(discovery ? { discoveryHash: sha256(JSON.stringify(discovery)), discoveryStatus: discovery.status } : {})
		},
		startedAt: reports.map((report) => report.startedAt).sort()[0],
		completedAt: reports.map((report) => report.completedAt).sort().at(-1)!,
		registryStatus: snapshot.status,
		registry,
		registryEvidence: registry.length ? evidenceFor(snapshot.evidence, '/lines?lang=ro') : undefined,
		observations,
		topology
	};
	return { ...input, captureId: inventoryCaptureId(input) };
}
