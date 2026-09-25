import { decodeLineRegistry, decodeLineTopology, decodeStopMemberships, type StbLine, type StbStop, type StbStopMemberships } from '../src/lib/api/topology.ts';
import { CollectionError, canonicalRegistry, issueFrom, sha256, type Collector, type Issue, type ResponseEvidence, type TopologySnapshot } from './catalog-collection.ts';
import type { MembershipAuditReport } from './station-membership-audit.ts';
import { transitDay } from './transit-day.ts';
import { normalizeTransportType } from '../src/lib/api/transport.ts';

export interface DiscoveredService {
 id: number;
 triggerStops: number[];
 status: 'verified' | 'unresolved';
 topology?: StbLine & { directions: { '0': number[]; '1': number[] }; allStopIds: number[]; stops: StbStop[] };
 issues: Issue[];
 evidence: ResponseEvidence[];
}
export interface DiscoveredStop {
 apiStopId: number;
 name?: string;
 lines?: StbStopMemberships['lines'];
 issues: Issue[];
}
export interface ServiceDiscoveryReport {
 schemaVersion: 1;
 source: string;
 snapshotHash: string;
 auditHash: string;
 catalogHash: string;
 status: 'complete' | 'inconclusive';
 services: DiscoveredService[];
 stops: DiscoveredStop[];
 pendingServices: number[];
 pendingStops: number[];
 issues: Issue[];
 evidence: ResponseEvidence[];
 startedAt: string;
 completedAt: string;
}
export interface DiscoveryOptions {
 maxRounds?: number;
 maxServices?: number;
 maxStops?: number;
 /** Bind to the caller's current catalog, rather than accepting an unrelated audit. */
 catalogHash: string;
 maxAgeMs?: number;
}
type Membership = StbStopMemberships['lines'][number];
const stopPath = (id: number) => `/lines/stop?stop_id=${id}`;
const registryPath = '/lines?lang=ro';
const sorted = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);
function sameStop(a: StbStop, b: StbStop): boolean {
 return a.name === b.name && Math.abs(a.lat - b.lat) <= 0.00001 && Math.abs(a.lon - b.lon) <= 0.00001;
}
function sameLine(a: StbLine, b: StbLine): boolean {
 return a.id === b.id && a.name === b.name && a.rawType === b.rawType && a.type === b.type;
}

/** Explore positive observations only. Discovery never promotes services into the runtime catalog. */
export async function discoverObservedServices(
 collector: Collector,
 snapshot: TopologySnapshot,
 audit: MembershipAuditReport,
 options: DiscoveryOptions
): Promise<ServiceDiscoveryReport> {
 const limits = { rounds: options.maxRounds ?? 3, services: options.maxServices ?? 25, stops: options.maxStops ?? 250 };
 for (const [key, value] of Object.entries(limits)) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid discovery ${key} cap`);
 }
 const maxAge = options.maxAgeMs ?? 6 * 60 * 60_000;
 if (!Number.isFinite(maxAge) || maxAge <= 0) throw new Error('Invalid discovery evidence max age');
 const started = collector.now();
 const report: ServiceDiscoveryReport = {
  schemaVersion: 1, source: snapshot.source, snapshotHash: sha256(JSON.stringify(snapshot)),
  auditHash: sha256(JSON.stringify(audit)), catalogHash: audit.catalogHash,
  status: 'inconclusive', services: [], stops: [], pendingServices: [], pendingStops: [],
  issues: [], evidence: [], startedAt: new Date(started).toISOString(), completedAt: ''
 };
 const issue = (code: string, path: string, message: string): Issue => ({ code, path, message });
 const fresh = (date: string) => {
  const time = Date.parse(date);
  return Number.isFinite(time) && time <= started && started - time < maxAge && transitDay(time) === transitDay(started);
 };
 if (snapshot.status !== 'complete' || snapshot.issues.length || !snapshot.registry.length) {
  report.issues.push(issue('incomplete-inventory', 'topology', 'Discovery requires a complete registry snapshot'));
 }
 if (snapshot.source !== collector.source || audit.source !== snapshot.source || audit.snapshotHash !== report.snapshotHash ||
  !/^[a-f0-9]{64}$/.test(audit.catalogHash) || audit.catalogHash !== options.catalogHash || audit.inventoryScope !== 'catalog-and-topology') {
  report.issues.push(issue('input-binding', 'audit', 'Audit must match the source, snapshot and current catalog'));
 }
 if (Date.parse(snapshot.startedAt) > Date.parse(snapshot.completedAt) || Date.parse(audit.startedAt) > Date.parse(audit.completedAt)) {
  report.issues.push(issue('input-interval', 'audit', 'Capture timestamps are not ordered'));
 }
 if (![snapshot.startedAt, snapshot.completedAt, audit.startedAt, audit.completedAt,
  ...snapshot.evidence.map(entry => entry.capturedAt), ...audit.evidence.map(entry => entry.capturedAt)].every(fresh)) {
  report.issues.push(issue('stale-input', 'audit', 'Inputs must be fresh and from the current Bucharest transit day'));
 }
 if (report.issues.length) {
  report.completedAt = new Date(collector.now()).toISOString();
  return report;
 }
 const registered = new Map(snapshot.registry.map(line => [line.id, line]));
 const knownStops = new Map(snapshot.stops.map(stop => [stop.id, stop]));
 const visitedStops = new Set(audit.stops.map(stop => stop.apiStopId));
 const observations = new Map<number, Array<{ stopId: number; line: Membership }>>();
 const services = new Map<number, DiscoveredService>();
 const pendingServices = new Set<number>();
 const pendingStops = new Set<number>();
 const receivedEvidence = new Map<string, ResponseEvidence>();
 let halted = false;
 const addObservation = (stopId: number, line: Membership) => {
  if (registered.has(line.id)) return;
  const observed = observations.get(line.id) ?? [];
  observed.push({ stopId, line });
  observations.set(line.id, observed);
  let service = services.get(line.id);
  if (!service) {
   service = { id: line.id, triggerStops: [], status: 'unresolved', issues: [], evidence: [] };
   services.set(line.id, service);
   pendingServices.add(line.id);
  }
  service.triggerStops = sorted(new Set(observed.map(item => item.stopId)));
  if (!line.type || !sameLine(observed[0].line, line)) {
   service.issues.push(issue(!line.type ? 'unknown-type' : 'service-conflict', stopPath(stopId), `Conflicting or unknown identity for service ${line.id}`));
   service.status = 'unresolved';
   delete service.topology;
  } else if (service.topology && !service.topology.directions[line.directionId].includes(stopId)) {
   service.issues.push(issue('topology-contradiction', stopPath(stopId), `Service ${line.id} topology omits observed stop/direction`));
   service.status = 'unresolved';
   delete service.topology;
  }
 };
 for (const row of audit.stops) {
  const evidence = audit.evidence.find(entry => entry.path === stopPath(row.apiStopId));
  const hasCandidate = row.lines?.some(line => !registered.has(line.id));
  if (hasCandidate && (!Number.isSafeInteger(row.apiStopId) || row.apiStopId <= 0 || !row.name?.trim() || !evidence || !/^[a-f0-9]{64}$/.test(evidence.sha256) || row.lines?.some(line =>
   !Number.isSafeInteger(line.id) || line.id <= 0 || !line.name?.trim() || !line.rawType?.trim() ||
   (line.directionId !== 0 && line.directionId !== 1) || line.type !== normalizeTransportType(line.rawType)))) {
   report.issues.push(issue('invalid-seed', stopPath(row.apiStopId), 'Positive audit observations lack valid identity or response evidence'));
   continue;
  }
  if (hasCandidate && row.issues.some(item => !['unregistered-line', 'unknown-type'].includes(item.code))) {
   report.issues.push(issue('invalid-seed', stopPath(row.apiStopId), 'Positive audit observations have unresolved response errors'));
   continue;
  }
  // Unregistered membership is precisely the discovery seed, not a malformed response.
  if (!row.name || !row.lines?.length || !evidence || row.issues.some(item => !['unregistered-line', 'unknown-type'].includes(item.code))) continue;
  for (const line of row.lines) addObservation(row.apiStopId, line);
 }
 const get = async (path: string, force = false) => {
  const body = await collector.get(path, force);
  const evidence = collector.evidence.get(path);
  if (!evidence || evidence.sha256 !== sha256(body)) throw new CollectionError('missing-evidence', 'Response lacks matching collector evidence');
  receivedEvidence.set(path, evidence);
  return body;
 };
 const fail = (error: unknown, path: string, target: Issue[]) => {
  const entry = issueFrom(error, path);
  target.push(entry);
  if (error instanceof CollectionError && ['auth', 'budget'].includes(error.code)) halted = true;
 };
 let rounds = 0;
 let attemptedServices = 0;
 let attemptedStops = 0;
 for (let round = 0; round < limits.rounds && (pendingServices.size || pendingStops.size) && !halted; round++) {
  rounds++;
  for (const id of sorted(pendingServices)) {
   if (attemptedServices >= limits.services || halted) break;
   pendingServices.delete(id);
   attemptedServices++;
   const service = services.get(id)!;
   if (service.issues.length) continue;
   collector.progress?.(`Discovery round ${round + 1}: service ${id}`);
   const identity = observations.get(id)![0].line;
   const stagedStops = new Map<number, StbStop>();
   const topology: NonNullable<DiscoveredService['topology']> = {
    id, name: identity.name, type: identity.type, rawType: identity.rawType,
    directions: { '0': [], '1': [] }, allStopIds: [], stops: []
   };
   const paths: string[] = [];
   for (const direction of ['all', '0', '1'] as const) {
    const path = `/lines/${id}${direction === 'all' ? '' : `/direction/${direction}`}?lang=ro`;
    paths.push(path);
    try {
     const detail = decodeLineTopology(await get(path));
     if (!detail.type || !sameLine(identity, detail)) throw new Error('Observed/detail identity mismatch');
     const ids = sorted(new Set(detail.stops.map(stop => stop.id)));
     if (direction === 'all') topology.allStopIds = ids;
     else topology.directions[direction] = ids;
     for (const stop of detail.stops) {
      const previous = stagedStops.get(stop.id) ?? knownStops.get(stop.id);
      if (previous && !sameStop(previous, stop)) throw new CollectionError('stop-conflict', `Conflicting identity/coordinates for stop ${stop.id}`);
      stagedStops.set(stop.id, stop);
     }
    } catch (error) {
     fail(error, path, service.issues);
     if (halted) break;
    }
   }
   service.evidence = paths.flatMap(path => receivedEvidence.has(path) ? [receivedEvidence.get(path)!] : []);
   const union = sorted(new Set([...topology.directions['0'], ...topology.directions['1']]));
   if (!service.issues.length && JSON.stringify(union) !== JSON.stringify(topology.allStopIds)) {
    service.issues.push(issue('direction-coverage', `line:${id}`, 'Combined detail differs from direction union'));
   }
   if (!service.issues.length && observations.get(id)!.some(({ stopId, line }) => !topology.directions[line.directionId].includes(stopId))) {
    service.issues.push(issue('topology-contradiction', `line:${id}`, 'Topology omits observed stop/direction'));
   }
   if (!service.issues.length) {
    topology.stops = [...stagedStops.values()].sort((a, b) => a.id - b.id);
    service.status = 'verified';
    service.topology = topology;
    for (const stop of topology.stops) {
     if (!knownStops.has(stop.id) && !visitedStops.has(stop.id)) pendingStops.add(stop.id);
     knownStops.set(stop.id, stop);
    }
   }
  }
  for (const id of sorted(pendingStops)) {
   if (attemptedStops >= limits.stops || halted) break;
   pendingStops.delete(id);
   visitedStops.add(id);
   attemptedStops++;
   const row: DiscoveredStop = { apiStopId: id, issues: [] };
   report.stops.push(row);
   const path = stopPath(id);
   try {
    const response = decodeStopMemberships(await get(path), id);
    if (response.name !== knownStops.get(id)?.name) throw new CollectionError('stop-conflict', 'Topology/membership stop name mismatch');
    if (!response.lines.length) throw new CollectionError('no-memberships', 'Named stop returned no positive memberships');
    row.name = response.name;
    row.lines = response.lines;
    for (const line of response.lines) {
     if (!line.type) row.issues.push(issue('unknown-type', path, `Unknown transport type for service ${line.id}`));
     const registeredLine = registered.get(line.id);
     if (registeredLine && (!sameLine(registeredLine, line) || !snapshot.lines.find(item => item.id === line.id)?.directions[line.directionId].includes(id))) {
      row.issues.push(issue('topology-contradiction', path, `Registered service ${line.id} contradicts its captured topology`));
     }
     addObservation(id, line);
    }
   } catch (error) { fail(error, path, row.issues); }
  }
 }
 report.pendingServices = sorted(pendingServices);
 report.pendingStops = sorted(pendingStops);
 if (pendingServices.size && attemptedServices >= limits.services) report.issues.push(issue('service-limit', 'discovery', `Service limit ${limits.services} reached`));
 if (pendingStops.size && attemptedStops >= limits.stops) report.issues.push(issue('stop-limit', 'discovery', `New stop limit ${limits.stops} reached`));
 if ((pendingServices.size || pendingStops.size) && rounds >= limits.rounds) report.issues.push(issue('round-limit', 'discovery', `Discovery frontier remains after ${limits.rounds} rounds`));
 if (halted) report.issues.push(issue('registry-not-checked', registryPath, 'Authentication or collection budget stopped discovery before final registry validation'));
 else {
  try {
   const registry = decodeLineRegistry(await get(registryPath, true));
   if (canonicalRegistry(registry) !== canonicalRegistry(snapshot.registry)) report.issues.push(issue('registry-changed', registryPath, 'Registry changed since the topology snapshot'));
  } catch (error) { fail(error, registryPath, report.issues); }
 }
 report.services = [...services.values()].sort((a, b) => a.id - b.id);
 report.evidence = [...receivedEvidence.values()];
 report.startedAt = [report.startedAt, ...report.evidence.map(entry => entry.capturedAt)].sort()[0];
 report.completedAt = new Date(collector.now()).toISOString();
 if ([snapshot.startedAt, audit.startedAt, ...report.evidence.map(entry => entry.capturedAt)].some(date => {
  const captured = Date.parse(date);
  return !Number.isFinite(captured) || captured > collector.now() || collector.now() - captured >= maxAge;
 })) report.issues.push(issue('stale-evidence', 'discovery', 'Discovery contains expired or invalid response evidence'));
 if (transitDay(Date.parse(report.startedAt)) !== transitDay(Date.parse(report.completedAt))) report.issues.push(issue('transit-day-changed', 'discovery', 'Discovery crossed 04:00 Europe/Bucharest'));
 report.status = report.issues.length || report.services.some(service => service.status !== 'verified') || report.stops.some(stop => stop.issues.length) ? 'inconclusive' : 'complete';
 return report;
}
