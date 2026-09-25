import { resolve } from 'node:path';
import { collectTopology, createCollector, writeJsonAtomic } from './catalog-collection.ts';
import { collectorOptions, option, STB_SOURCE } from './catalog-cli.ts';
const options = await collectorOptions();
const snapshot = await collectTopology(await createCollector(options), STB_SOURCE);
snapshot.via = options.source;
const output = resolve(option('--output', 'data/stb-topology.json')!);
await writeJsonAtomic(output, snapshot);
console.log(
	JSON.stringify({
		status: snapshot.status,
		lines: snapshot.registry.length,
		stops: snapshot.stops.length,
		issues: snapshot.issues.length,
		output
	})
);
if (snapshot.status !== 'complete') process.exitCode = 2;
