import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeLineRegistry, decodeLineTopology } from '../src/lib/api/topology.ts';
import snapshot from '../catalog/stb-topology.json';
import { loadStations, stationServesLine } from '../src/lib/stations/data.ts';
import { findStationsInBounds } from '../src/lib/stations/geo.ts';
import { SUBWAY_STOP_IDS } from '../src/lib/stations/subway-stops.ts';

const binary=(name:string)=>new Uint8Array(readFileSync(new URL(`../src/lib/api/fixtures/topology/${name}.pb`,import.meta.url)));

describe('captured STB topology contract',()=>{
 it('decodes the full observed registry and actual trolleybus identifier',()=>{
  const lines=decodeLineRegistry(binary('lines'));
  expect(lines).toHaveLength(203);
  expect(lines.find(line=>line.name==='66')).toMatchObject({id:72,type:'TROLLEYBUS',rawType:'CABLE_CAR'});
 });
 it('retains both N109 directions including Isovolta from raw protobuf',()=>{
  const all=decodeLineTopology(binary('lines_199'));
  const outbound=decodeLineTopology(binary('lines_199_direction_0'));
  const inbound=decodeLineTopology(binary('lines_199_direction_1'));
  expect(new Set(all.stops.map(stop=>stop.id)).size).toBe(55);
  for(const id of [6084,6165,7267])expect(all.stops.some(s=>s.id===id)).toBe(true);
  expect(new Set([...outbound.stops,...inbound.stops].map(s=>s.id))).toEqual(new Set(all.stops.map(s=>s.id)));
 });
});

describe('every captured line and direction reaches the production map',()=>{
 const stations=loadStations();
 const byApiId=new Map<number,typeof stations>();
 for(const station of stations){
  for(const id of station.apiStopIds ?? SUBWAY_STOP_IDS[station.id] ?? [station.id]){
   const markers=byApiId.get(id)??[];markers.push(station);byApiId.set(id,markers);
  }
 }
 const world={south:-90,north:90,west:-180,east:180};
 for(const line of snapshot.registry){
  it(`${line.rawType}:${line.name} (${line.id}), both directions, above the marker cap`,()=>{
   const topology=snapshot.lines.find(item=>item.id===line.id)!;
   expect(topology,`missing topology ${line.id}`).toBeDefined();
   const selection={lineId:line.id,lineName:line.name,vehicleType:line.rawType};
   const served=new Set(stations.filter(s=>stationServesLine(s,selection)).map(s=>s.id));
   const visible=new Set(findStationsInBounds(world,stations,100,null,served).map(s=>s.id));
   const expected=new Set<number>();
   for(const direction of ['0','1'] as const){
    expect(topology.directions[direction].length).toBeGreaterThan(0);
    for(const id of topology.directions[direction]){
     const markers=byApiId.get(id);
     expect(markers,`${line.name}/${direction}: unresolved source stop ${id}`).toBeDefined();
     for(const marker of markers??[]){
      expected.add(marker.id);
      expect(served.has(marker.id),`${line.name}/${direction}: unrecognized marker ${marker.id}`).toBe(true);
      expect(visible.has(marker.id),`${line.name}/${direction}: filtered marker ${marker.id}`).toBe(true);
     }
    }
   }
   expect(served).toEqual(expected);
  });
 }
});
