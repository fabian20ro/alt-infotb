import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { collectorOptions, option, numericOption, STB_SOURCE } from './catalog-cli.ts';
import { createCollector, writeJsonAtomic, sha256, type TopologySnapshot } from './catalog-collection.ts';
import type { MembershipAuditReport } from './station-membership-audit.ts';
import { discoverObservedServices } from './service-discovery.ts';
import { createInventoryCapture } from './service-inventory-capture.ts';
import { updateServiceInventory, type ServiceInventory } from './service-inventory.ts';

const snapshot: TopologySnapshot = JSON.parse(await readFile(resolve(option('--snapshot', 'catalog/stb-topology.json')!), 'utf8'));
const auditPath = option('--audit');
const previousPath = option('--previous');
const audit: MembershipAuditReport | undefined = auditPath ? JSON.parse(await readFile(resolve(auditPath), 'utf8')) : undefined;
const previous: ServiceInventory | undefined = previousPath ? JSON.parse(await readFile(resolve(previousPath), 'utf8')) : undefined;
const output = resolve(option('--output', 'data/service-observation')!);
await mkdir(output, { recursive: true });
if (audit && !process.argv.includes('--live')) throw new Error('--live required for bounded service discovery');
if (snapshot.source !== STB_SOURCE) throw new Error('Unexpected topology provider');
const catalog = audit ? JSON.parse(await readFile(resolve(option('--catalog', 'src/lib/stations/stations.json')!), 'utf8')) : undefined;
const discovery = audit ? await discoverObservedServices(
	{ ...await createCollector(await collectorOptions()), source: STB_SOURCE }, snapshot, audit,
	{ catalogHash: sha256(JSON.stringify(catalog)), maxRounds: numericOption('--max-rounds', 3),
		maxServices: numericOption('--max-services', 25), maxStops: numericOption('--max-stops', 250) }
) : undefined;
if (discovery) await writeJsonAtomic(join(output, 'service-discovery.json'), discovery);
const capture = createInventoryCapture(snapshot, audit, discovery);
const inventory = updateServiceInventory(previous, capture);
await writeJsonAtomic(join(output, 'service-inventory.json'), inventory);
console.log(JSON.stringify({ status: discovery?.status ?? snapshot.status, scope: audit ? 'registry-and-stop-discovery' : 'registry-only', output }));
// Evidence persists even when the strict observation remains inconclusive.
if (snapshot.status !== 'complete' || (audit && audit.status !== 'conform') || (discovery && discovery.status !== 'complete')) process.exitCode = 2;
