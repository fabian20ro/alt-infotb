import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { option } from './catalog-cli.ts';
import { verifyStbCatalog, validatePublication, type BoundMembershipAudit } from './catalog-publication.ts';
import type { StbStationCatalog } from './stb-catalog.ts';
import type { TopologySnapshot } from './catalog-collection.ts';

const valueFlags = new Set(['--snapshot', '--catalog', '--output', '--previous', '--confirmation', '--audit']);
const booleanFlags = new Set(['--publish-check', '--reviewed-bulk-change']);
for (let index = 2; index < process.argv.length; index++) {
	const argument = process.argv[index];
	if (valueFlags.has(argument)) {
		if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`Missing ${argument}`);
		index++;
	} else if (!booleanFlags.has(argument)) throw new Error(`Unknown option ${argument}`);
}
const publication = process.argv.includes('--publish-check');
if (!publication && ['--previous', '--confirmation', '--audit', '--reviewed-bulk-change'].some((flag) => process.argv.includes(flag))) {
	throw new Error('Publication options require --publish-check');
}
const snapshot: TopologySnapshot = JSON.parse(await readFile(resolve(option('--snapshot', 'catalog/stb-topology.json')!), 'utf8'));
const catalog: StbStationCatalog = JSON.parse(await readFile(resolve(option('--catalog', 'src/lib/stations/stations.json')!), 'utf8'));
const report = verifyStbCatalog(snapshot, catalog);
let publicationReport: ReturnType<typeof validatePublication> | undefined;
if (publication) {
	const auditPath = option('--audit');
	if (!auditPath) throw new Error('--publish-check requires --audit');
	const previousPath = option('--previous'), confirmationPath = option('--confirmation');
	const previous: TopologySnapshot | undefined = previousPath ? JSON.parse(await readFile(resolve(previousPath), 'utf8')) : undefined;
	const confirmation: TopologySnapshot | undefined = confirmationPath ? JSON.parse(await readFile(resolve(confirmationPath), 'utf8')) : undefined;
	const audit: BoundMembershipAudit = JSON.parse(await readFile(resolve(auditPath), 'utf8'));
	publicationReport = validatePublication(previous, snapshot, confirmation, audit, catalog, { reviewedBulkChange: process.argv.includes('--reviewed-bulk-change') });
}
const result = publicationReport ? { ...report, publication: publicationReport } : report;
const output = option('--output');
if (output) await writeFile(resolve(output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
