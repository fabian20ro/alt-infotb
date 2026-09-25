import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInventoryCapture } from './service-inventory-capture.ts';
import { updateServiceInventory } from './service-inventory.ts';
import { sha256, type TopologySnapshot } from './catalog-collection.ts';
import type { MembershipAuditReport } from './station-membership-audit.ts';
import type { ServiceDiscoveryReport } from './service-discovery.ts';

const snapshot: TopologySnapshot = JSON.parse(readFileSync('catalog/stb-topology.json', 'utf8'));
function audit(): MembershipAuditReport {
 const time = snapshot.completedAt;
 return {
  schemaVersion: 1, source: snapshot.source, via: 'https://proxy.example', snapshotHash: sha256(JSON.stringify(snapshot)), catalogHash: 'b'.repeat(64),
  status: 'inconclusive', inventoryScope: 'catalog-and-topology', startedAt: time, completedAt: time,
  coverage: {catalogMarkers:1,verifiedMarkers:0,unverifiedMarkers:1,knownApiStops:1,requested:1,verified:0,unverified:1},
  unmappedMarkers:[], discrepancies:[], issues:[],
  stops:[{apiStopId:6207,markerIds:[6207],status:'unverified',name:'Pasaj CFR Chitila',
   lines:[{id:907,name:'429',type:'BUS',rawType:'BUS',directionId:1}],issues:[{code:'unregistered-line',path:'/lines/stop?stop_id=6207',message:'Unknown service'}]}],
  evidence:[{path:'/lines/stop?stop_id=6207',capturedAt:time,sha256:'c'.repeat(64)}]
 };
}
function discovery(report: MembershipAuditReport): ServiceDiscoveryReport {
 return {schemaVersion:1,source:snapshot.source,snapshotHash:report.snapshotHash!,auditHash:sha256(JSON.stringify(report)),catalogHash:report.catalogHash,
  status:'inconclusive',startedAt:report.startedAt,completedAt:report.completedAt,services:[{id:907,triggerStops:[6207],status:'unresolved',issues:[{code:'empty',path:'/lines/907?lang=ro',message:'Empty response'}],evidence:[]}],
  stops:[],pendingServices:[],pendingStops:[],issues:[],evidence:[]};
}
describe('source artifacts to historical inventory', () => {
 it('normalizes all bundled registry identities using real evidence timestamps', () => {
  const result=updateServiceInventory(undefined,createInventoryCapture(snapshot));
  expect(result.services).toHaveLength(snapshot.registry.length);
  expect(result.services.every(item=>item.registryStatus==='listed'&&item.topologyStatus==='verified'&&item.operationalStatus==='unknown')).toBe(true);
 });
 it('retains unresolved positive stop evidence without aliasing to the listed name', () => {
  const report=audit();const result=updateServiceInventory(undefined,createInventoryCapture(snapshot,report,discovery(report)));
  expect(result.services.find(item=>item.id===907)).toMatchObject({registryStatus:'absent',topologyStatus:'unresolved',observedAtStops:[6207],lastSeenAt:report.evidence[0].capturedAt});
  expect(result.services.find(item=>item.id===796)?.registryStatus).toBe('listed');
  expect(result.captures[0].observations[0].directionId).toBe(1);
  expect(result.captures[0].assessment).toMatchObject({scope:'registry-and-stops',auditStatus:'inconclusive',discoveryStatus:'inconclusive',knownStops:1,requestedStops:1});
  expect(snapshot.registry.some(item=>item.id===907)).toBe(false);
 });
 it('rejects mismatched source artifacts and missing response proof', () => {
  const report=audit();report.snapshotHash='f'.repeat(64);
  expect(()=>createInventoryCapture(snapshot,report)).toThrow('source or hash mismatch');
  const foreign=audit();foreign.source='https://another-provider.example';
  expect(()=>createInventoryCapture(snapshot,foreign)).toThrow('source or hash mismatch');
  const missing=audit();missing.evidence=[];
  expect(()=>createInventoryCapture(snapshot,missing)).toThrow('Missing observation evidence');
  const valid=audit();const found=discovery(valid);found.auditHash='f'.repeat(64);
  expect(()=>createInventoryCapture(snapshot,valid,found)).toThrow('artifact mismatch');
 });
 it('does not bind initial registry labels to a changed final registry response', () => {
  const changed=structuredClone(snapshot);changed.status='inconclusive';
  changed.issues.push({code:'registry-changed',path:'/lines?lang=ro',message:'Changed during capture'});
  const result=updateServiceInventory(undefined,createInventoryCapture(changed));
  expect(result.services).toEqual([]);
  expect(result.captures[0].registryStatus).toBe('inconclusive');
 });
 it('records partial registry evidence without certifying its topology', () => {
  const partial=structuredClone(snapshot);partial.status='inconclusive';
  const result=updateServiceInventory(undefined,createInventoryCapture(partial));
  expect(result.services.every(item=>item.topologyStatus==='unresolved')).toBe(true);
 });
});
