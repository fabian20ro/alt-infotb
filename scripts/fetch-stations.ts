/**
 * Generate the bundled station catalog from extracted TPBI GTFS files.
 *
 * Usage:
 * node scripts/fetch-stations.ts \
 *   --stops /path/to/stops.txt \
 *   --feed-info /path/to/feed_info.txt \
 *   --source-updated-at "Sat, 11 Jul 2026 13:48:53 GMT"
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './station-catalog.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function option(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
	return value;
}

const stopsPath = resolve(option('--stops') ?? resolve(scriptDirectory, '../data/gtfs/stops.txt'));
const feedInfoPath = resolve(option('--feed-info') ?? resolve(scriptDirectory, '../data/gtfs/feed_info.txt'));
const outputPath = resolve(option('--output') ?? resolve(scriptDirectory, '../src/lib/stations/stations.json'));
const sourceUpdatedAt = option('--source-updated-at') ?? statSync(stopsPath).mtime.toISOString();

const catalog = buildCatalog(
	readFileSync(stopsPath, 'utf8'),
	readFileSync(feedInfoPath, 'utf8'),
	sourceUpdatedAt
);

writeFileSync(outputPath, JSON.stringify(catalog));
console.log(`Generated TPBI catalog ${catalog.feedVersion} with ${catalog.stations.length} stations`);
console.log(`Source updated: ${catalog.sourceUpdatedAt}`);
console.log(`Written to: ${outputPath}`);
