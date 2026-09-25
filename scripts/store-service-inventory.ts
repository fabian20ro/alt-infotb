import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { option } from './catalog-cli.ts';
import { restoreInventoryHistory, saveInventoryHistory } from './service-inventory-storage.ts';

const restore = process.argv.includes('--restore');
const save = process.argv.includes('--save');
if (restore === save) throw new Error('Choose exactly one of --restore or --save');
const headPath = resolve(option('--head-file', 'data/service-inventory-head.json')!);
const remote = option('--remote', 'origin');
if (restore) {
	const outputPath = option('--output');
	if (!outputPath) throw new Error('--restore requires --output');
	const head = await restoreInventoryHistory({ outputPath, remote });
	await mkdir(dirname(headPath), { recursive: true });
	await writeFile(`${headPath}.tmp`, `${JSON.stringify({ head })}\n`);
	await rename(`${headPath}.tmp`, headPath);
	console.log(head ? `Restored service inventory ${head}` : 'No saved service inventory; first observation run');
} else {
	const inputPath = option('--input');
	if (!inputPath) throw new Error('--save requires --input');
	const lease: unknown = JSON.parse(await readFile(headPath, 'utf8'));
	if (!lease || typeof lease !== 'object' || !('head' in lease) || (lease.head !== null && typeof lease.head !== 'string')) {
		throw new Error('Invalid inventory head file; restore history before saving');
	}
	const head = await saveInventoryHistory({ inputPath, expectedHead: lease.head, remote });
	console.log(`Saved service inventory ${head}`);
}
