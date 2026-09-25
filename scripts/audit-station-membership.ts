import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { collectorOptions, option } from './catalog-cli.ts';
import { createCollector, writeJsonAtomic, type TopologySnapshot } from './catalog-collection.ts';
import { auditStationMembership, formatMembershipAuditMarkdown, type AuditCatalog } from './station-membership-audit.ts';

if (!process.argv.includes('--full') || !process.argv.includes('--live')) {
	throw new Error('Explicit --full --live is required; this audit visits every known API stop');
}
const catalogPath = resolve(option('--catalog', 'src/lib/stations/stations.json')!);
const outputDirectory = resolve(option('--output', 'data/stb-audit')!);
const snapshotPath = option('--snapshot');
const catalog: AuditCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const snapshot: TopologySnapshot | undefined = snapshotPath
	? JSON.parse(await readFile(resolve(snapshotPath), 'utf8')) : undefined;
const collector = await createCollector(await collectorOptions());
const report = await auditStationMembership(collector, catalog, snapshot);
await mkdir(outputDirectory, { recursive: true });
await writeJsonAtomic(join(outputDirectory, 'membership-audit.json'), report);
await writeFile(join(outputDirectory, 'membership-audit.md'), formatMembershipAuditMarkdown(report));
console.log(`${report.status}: ${report.coverage.verified}/${report.coverage.knownApiStops} API stops verified; ${report.discrepancies.length} discrepancies. Reports: ${outputDirectory}`);
process.exitCode = report.status === 'conform' ? 0 : report.status === 'nonconform' ? 1 : 2;
