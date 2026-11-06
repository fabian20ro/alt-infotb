import { parseArgs } from 'node:util';
import { generatePackage } from './generate.ts';
import { validatePackage } from './content.ts';
import { readerFor } from './profile.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
	'public-root': { type: 'string' }, directory: { type: 'string' }, output: { type: 'string', default: 'out' },
	cache: { type: 'string', default: '.cache' }, 'pmtiles-cli': { type: 'string', default: 'pmtiles' },
	'archive-file': { type: 'string' }, 'archive-url': { type: 'string' }
} });
function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`Required: ${name}`);
	return value;
}
try {
	if (positionals.length !== 1 || !['generate', 'verify'].includes(positionals[0])) throw new Error('Usage: node src/cli.ts generate|verify --public-root https://…/packages/ [options]');
	const publicRoot = required(values['public-root'], '--public-root');
	const reader = readerFor(publicRoot);
	if (positionals[0] === 'generate') {
		const result = await generatePackage({ publicRoot, outputRoot: values.output, cacheDirectory: values.cache,
			pmtilesCli: values['pmtiles-cli'], archiveFile: values['archive-file'], archiveUrl: values['archive-url'] });
		console.log(JSON.stringify({ directory: result.directory, manifestSha256: result.manifestSha256,
			totalBytes: result.manifest.totalBytes, fileCount: result.fileCount, validatedTiles: result.validatedTiles, validatedFeatures: result.validatedFeatures }, null, 2));
	} else {
		const directory = required(values.directory, '--directory');
		const validated = await validatePackage(directory, reader, { pmtilesCli: values['pmtiles-cli'] });
		console.log(JSON.stringify({ manifestSha256: validated.manifestSha256, fileCount: validated.fileCount,
			totalBytes: validated.manifest.totalBytes, validatedTiles: validated.validatedTiles, validatedFeatures: validated.validatedFeatures }, null, 2));
	}
} catch (error) {
	// Never stringify requests/credential-bearing objects from providers.
	console.error(error instanceof Error ? error.message : 'Pipeline failed');
	process.exitCode = 1;
}
