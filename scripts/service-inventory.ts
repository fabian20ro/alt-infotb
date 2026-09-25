import type { StbLine } from '../src/lib/api/topology.ts';
import { normalizeTransportType } from '../src/lib/api/transport.ts';
import { sha256, type Issue, type ResponseEvidence } from './catalog-collection.ts';

export type InventoryEvidence = ResponseEvidence;
export interface InventoryObservation extends InventoryEvidence {
	id: number;
	name: string;
	rawType: string;
	apiStopId?: number;
	directionId?: 0 | 1;
}
export interface InventoryTopology {
	id: number;
	status: 'verified' | 'unresolved' | 'not-probed';
	issues: Issue[];
	evidence: InventoryEvidence[];
}
export interface InventoryAssessment {
	scope: 'registry-only' | 'registry-and-stops';
	snapshotHash: string;
	auditHash?: string;
	discoveryHash?: string;
	auditStatus?: 'conform' | 'nonconform' | 'inconclusive';
	discoveryStatus?: 'complete' | 'inconclusive';
	knownStops?: number;
	requestedStops?: number;
}
export interface InventoryCapture {
	captureId: string;
	/** Canonical upstream identity, never the proxy URL. */
	source: string;
	startedAt: string;
	completedAt: string;
	registryStatus: 'complete' | 'inconclusive';
	registry: StbLine[];
	registryEvidence?: InventoryEvidence;
	observations: InventoryObservation[];
	topology: InventoryTopology[];
	/** Acquisition coverage is independent of positive observations and operating state. */
	assessment?: InventoryAssessment;
}
export interface InventoryLabel {
	name: string;
	rawType: string;
	firstSeenAt: string;
	lastSeenAt: string;
}
export interface InventoriedService {
	id: number;
	firstSeenAt: string;
	lastSeenAt: string;
	/** Listing, absence and topology availability cannot establish operating state. */
	operationalStatus: 'unknown';
	registryStatus: 'listed' | 'absent' | 'unknown';
	topologyStatus: InventoryTopology['status'];
	/** Positive stop observations in the latest capture only, not historical membership. */
	observedAtStops: number[];
	labels: InventoryLabel[];
}
export interface ServiceInventory {
	schemaVersion: 1;
	source: string;
	/** Lossless history; retention needs an explicit future archival policy. */
	captures: InventoryCapture[];
	/** Rebuildable summaries; never used as runtime memberships or identity aliases. */
	services: InventoriedService[];
}

function fail(message: string): never { throw new Error(`Service inventory: ${message}`); }
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => compareText(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
	return JSON.stringify(value);
}
export function inventoryCaptureId(capture: Omit<InventoryCapture, 'captureId'>): string {
	return sha256(stable(capture));
}
function time(value: string): number {
	const result = Date.parse(value);
	if (typeof value !== 'string' || !Number.isFinite(result)) fail('invalid observation timestamp');
	return result;
}
function id(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) fail(`invalid service/stop ID ${value}`);
}
function label(value: { name: string; rawType: string }): void {
	if (typeof value.name !== 'string' || !value.name.trim() || typeof value.rawType !== 'string' || !value.rawType.trim()) fail('invalid service label');
}
function evidence(value: InventoryEvidence, capture: InventoryCapture): void {
	if (!value || !/^[a-f\d]{64}$/.test(value.sha256) || typeof value.path !== 'string' || !value.path.startsWith('/lines')) fail('invalid response evidence');
	const at = time(value.capturedAt);
	if (at < time(capture.startedAt) || at > time(capture.completedAt)) fail('evidence outside capture interval');
}
function validateCapture(capture: InventoryCapture): void {
	if (!capture || !Array.isArray(capture.registry) || !Array.isArray(capture.observations) || !Array.isArray(capture.topology)) fail('invalid capture structure');
	const { captureId, ...payload } = capture;
	if (captureId !== inventoryCaptureId(payload)) fail('capture hash mismatch');
	let source: URL;
	try { source = new URL(capture.source); } catch { fail('invalid upstream source'); }
	if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || source.search || source.hash) fail('invalid upstream source');
	if (time(capture.startedAt) > time(capture.completedAt)) fail('reversed capture interval');
	if (capture.assessment !== undefined) {
		const assessment = capture.assessment;
		if (!assessment || !['registry-only', 'registry-and-stops'].includes(assessment.scope) || !/^[a-f\d]{64}$/.test(assessment.snapshotHash)) fail('invalid capture assessment');
		const extras = [assessment.auditHash, assessment.auditStatus, assessment.discoveryHash, assessment.discoveryStatus, assessment.knownStops, assessment.requestedStops];
		if (assessment.scope === 'registry-only') {
			if (extras.some(value => value !== undefined)) fail('registry-only assessment contains stop audit fields');
		} else {
			if (!/^[a-f\d]{64}$/.test(assessment.auditHash ?? '') || !['conform', 'nonconform', 'inconclusive'].includes(assessment.auditStatus ?? '')) fail('stop assessment requires audit identity and status');
			if (!Number.isSafeInteger(assessment.knownStops) || assessment.knownStops! < 0 || !Number.isSafeInteger(assessment.requestedStops) || assessment.requestedStops! < 0 || assessment.requestedStops! > assessment.knownStops!) fail('invalid stop assessment coverage');
			if (assessment.discoveryHash !== undefined || assessment.discoveryStatus !== undefined) {
				if (!/^[a-f\d]{64}$/.test(assessment.discoveryHash ?? '') || !['complete', 'inconclusive'].includes(assessment.discoveryStatus ?? '')) fail('discovery assessment requires identity and status');
			}
		}
	}
	if (!['complete', 'inconclusive'].includes(capture.registryStatus)) fail('invalid registry status');
	if (capture.registryStatus === 'complete' && !capture.registry.length) fail('complete registry cannot be empty');
	if (capture.registry.length && !capture.registryEvidence) fail('registry requires timestamped evidence');
	if (capture.registryEvidence) {
		evidence(capture.registryEvidence, capture);
		if (capture.registryEvidence.path !== '/lines?lang=ro') fail('registry evidence has another endpoint');
	}
	const listed = new Set<number>();
	for (const line of capture.registry) {
		id(line.id); label(line);
		if (listed.has(line.id)) fail(`duplicate registry ID ${line.id}`);
		if (line.type !== normalizeTransportType(line.rawType)) fail(`inconsistent registry type ${line.id}`);
		listed.add(line.id);
	}
	for (const observation of capture.observations) {
		id(observation.id); label(observation); evidence(observation, capture);
		if (observation.directionId !== undefined && (observation.apiStopId === undefined || ![0, 1].includes(observation.directionId))) fail('invalid stop observation direction');
		if (observation.apiStopId !== undefined) {
			id(observation.apiStopId);
			if (observation.path !== `/lines/stop?stop_id=${observation.apiStopId}`) fail('stop observation endpoint differs');
		} else if (observation.path !== '/lines?lang=ro' && !new RegExp(`^/lines/${observation.id}(?:/direction/[01])?\\?lang=ro$`).test(observation.path)) fail('service observation endpoint differs');
	}
	const observed = new Set([...listed, ...capture.observations.map(item => item.id)]);
	const probed = new Set<number>();
	for (const topology of capture.topology) {
		id(topology.id);
		if (probed.has(topology.id)) fail(`duplicate topology ID ${topology.id}`);
		probed.add(topology.id);
		if (!observed.has(topology.id)) fail('topology lacks positive identity observation');
		if (!['verified', 'unresolved', 'not-probed'].includes(topology.status) || !Array.isArray(topology.issues) || !Array.isArray(topology.evidence)) fail('invalid topology observation');
		for (const item of topology.issues) if (!item || !item.code || !item.path || !item.message) fail('invalid topology issue');
		for (const item of topology.evidence) evidence(item, capture);
		if (topology.status === 'verified') {
			const paths = new Set(topology.evidence.map(item => item.path));
			if (topology.issues.length || ['', '/direction/0', '/direction/1'].some(suffix => !paths.has(`/lines/${topology.id}${suffix}?lang=ro`))) fail('verified topology requires three clean endpoint observations');
		}
	}
}

function applyCapture(services: InventoriedService[], capture: InventoryCapture): InventoriedService[] {
	const next = new Map(services.map(service => [service.id, structuredClone(service)]));
	const registry = new Set(capture.registry.map(line => line.id));
	const topology = new Map(capture.topology.map(item => [item.id, item.status]));
	// Registry presence is positive evidence even when a later consistency probe failed.
	const positives = [...capture.observations, ...capture.registry.map(line => ({ ...line, ...capture.registryEvidence! }))];
	for (const observation of positives) {
		let service = next.get(observation.id);
		if (!service) {
			service = { id: observation.id, firstSeenAt: observation.capturedAt, lastSeenAt: observation.capturedAt, operationalStatus: 'unknown', registryStatus: 'unknown', topologyStatus: 'not-probed', observedAtStops: [], labels: [] };
			next.set(service.id, service);
		}
		if (time(observation.capturedAt) < time(service.firstSeenAt)) service.firstSeenAt = observation.capturedAt;
		if (time(observation.capturedAt) > time(service.lastSeenAt)) service.lastSeenAt = observation.capturedAt;
		const existingLabel = service.labels.find(item => item.name === observation.name && item.rawType === observation.rawType);
		if (!existingLabel) service.labels.push({ name: observation.name, rawType: observation.rawType, firstSeenAt: observation.capturedAt, lastSeenAt: observation.capturedAt });
		else {
			if (time(observation.capturedAt) < time(existingLabel.firstSeenAt)) existingLabel.firstSeenAt = observation.capturedAt;
			if (time(observation.capturedAt) > time(existingLabel.lastSeenAt)) existingLabel.lastSeenAt = observation.capturedAt;
		}
	}
	for (const service of next.values()) {
		service.registryStatus = registry.has(service.id) ? 'listed' : capture.registryStatus === 'complete' ? 'absent' : 'unknown';
		service.topologyStatus = topology.get(service.id) ?? 'not-probed';
		service.observedAtStops = [...new Set(capture.observations.filter(item => item.id === service.id && item.apiStopId !== undefined).map(item => item.apiStopId!))].sort((a, b) => a - b);
		service.labels.sort((a, b) => compareText(a.name, b.name) || compareText(a.rawType, b.rawType));
	}
	return [...next.values()].sort((a, b) => a.id - b.id);
}

/** Validate persisted history and reconstruct its derived summaries before extending it. */
export function validateServiceInventory(inventory: ServiceInventory): void {
	if (!inventory || inventory.schemaVersion !== 1 || !Array.isArray(inventory.captures) || !inventory.captures.length || !Array.isArray(inventory.services)) fail('invalid inventory structure');
	let services: InventoriedService[] = [];
	const hashes = new Set<string>();
	let last = -Infinity;
	for (const capture of inventory.captures) {
		validateCapture(capture);
		if (capture.source !== inventory.source) fail('upstream source changed');
		if (hashes.has(capture.captureId)) fail('duplicate persisted capture');
		if (time(capture.completedAt) <= last) fail('capture history is not chronological');
		hashes.add(capture.captureId); last = time(capture.completedAt);
		services = applyCapture(services, capture);
	}
	if (stable(services) !== stable(inventory.services)) fail('derived summaries differ from capture history');
}

/** JSON boundary for persisted history readers. No unvalidated caller-owned object escapes. */
export function validateServiceInventoryHistory(value: unknown): ServiceInventory {
	validateServiceInventory(value as ServiceInventory);
	return structuredClone(value as ServiceInventory);
}

/** Pure, replay-safe append. Absence never deletes identities or establishes cancellation. */
export function updateServiceInventory(previous: ServiceInventory | undefined, capture: InventoryCapture): ServiceInventory {
	validateCapture(capture);
	if (previous) {
		validateServiceInventory(previous);
		if (previous.source !== capture.source) fail('upstream source changed');
		if (previous.captures.some(item => item.captureId === capture.captureId)) return structuredClone(previous);
		if (time(capture.completedAt) <= time(previous.captures.at(-1)!.completedAt)) fail('new capture is not chronological');
	}
	return { schemaVersion: 1, source: capture.source, captures: [...structuredClone(previous?.captures ?? []), structuredClone(capture)], services: applyCapture(previous?.services ?? [], capture) };
}
