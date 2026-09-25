import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHandler } from '../shared-api/src/index.ts';
import type { CollectorOptions } from './catalog-collection.ts';

export const STB_SOURCE = 'https://info.stb.ro/api/web/v2-6';

export function option(name: string, fallback?: string): string | undefined {
	const index = process.argv.indexOf(name);
	if (index === -1) return fallback;
	const value = process.argv[index + 1];
	if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
	return value;
}
export function numericOption(name: string, fallback: number): number {
	const value = Number(option(name, String(fallback)));
	if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
	return value;
}
/** Local collection invokes exactly the same proxy handler as Vite and Workers. */
export async function collectorOptions(): Promise<CollectorOptions> {
	const configPath = option('--proxy-config');
	const proxy = option(
		'--proxy',
		process.env.STB_CATALOG_PROXY ?? 'https://alt-stb-proxy.fabian20ro.workers.dev'
	)!;
	let request: CollectorOptions['request'];
	let source = proxy;
	if (configPath) {
		const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
		const silent = { debug() {}, info() {}, warn() {}, error() {} };
		const handler = createHandler(config, { logger: silent, clock: { now: Date.now } });
		source = 'https://info.stb.ro/api/web/v2-6 (shared local proxy)';
		request = (path, signal) =>
			handler(
				new Request(`http://localhost${path}`, { headers: { Origin: 'http://localhost' }, signal })
			);
	} else {
		const url = new URL(proxy);
		if (url.username || url.password || url.search || url.hash) {
			throw new Error('Proxy URL must not contain credentials, query parameters or a fragment');
		}
		if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
			throw new Error('Use HTTPS for a remote proxy');
		const origin = option('--origin', 'https://fabian20ro.github.io')!;
		request = (path, signal) =>
			fetch(`${proxy.replace(/\/$/, '')}${path}`, { headers: { Origin: origin }, signal });
	}
	return {
		source,
		request,
		directory: resolve(option('--cache', 'data/stb-cache')!),
		intervalMs: numericOption('--interval-ms', 100),
		timeoutMs: numericOption('--timeout-ms', 15_000),
		budgetMs: numericOption('--budget-ms', 3 * 60 * 60_000),
		maxAgeMs: numericOption('--max-age-ms', 6 * 60 * 60_000),
		progress: console.log
	};
}
