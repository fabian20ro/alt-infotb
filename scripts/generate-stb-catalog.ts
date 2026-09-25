import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildStbCatalog } from './stb-catalog.ts';
import { option } from './catalog-cli.ts';
import { writeJsonAtomic } from './catalog-collection.ts';
const read = async (path: string) => JSON.parse(await readFile(resolve(path), 'utf8'));
const catalog = buildStbCatalog(
	await read(option('--gtfs', 'catalog/gtfs-fallback.json')!),
	await read(option('--snapshot', 'catalog/stb-topology.json')!)
);
const output = resolve(option('--output', 'src/lib/stations/stations.json')!);
let previous;
try {
	previous = await read(output);
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
// Candidate provenance follows its capture; publishing separately gates semantic changes.
await writeJsonAtomic(output, catalog);
if (previous?.stb?.contentHash === catalog.stb.contentHash)
	console.log('Catalog semantic content unchanged; candidate provenance refreshed');
else
	console.log(
		`Generated ${catalog.stations.length} markers, ${catalog.stb.lineIds.length} STB lines: ${output}`
	);
