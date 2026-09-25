import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeLineRegistry, decodeLineTopology } from '../src/lib/api/topology.ts';
import type { StbLine, StbStop } from '../src/lib/api/topology.ts';
import { transitDay } from './transit-day.ts';

export interface Issue {
	code: string;
	path: string;
	message: string;
}
export interface ResponseEvidence {
	path: string;
	sha256: string;
	capturedAt: string;
}
export interface TopologySnapshot {
	schemaVersion: 1;
	status: 'complete' | 'inconclusive';
	source: string;
	/** Transport used to reach the upstream; not the provider's identity. */
	via?: string;
	startedAt: string;
	completedAt: string;
	registry: StbLine[];
	lines: Array<{ id: number; directions: { '0': number[]; '1': number[] }; allStopIds: number[] }>;
	stops: StbStop[];
	evidence: ResponseEvidence[];
	issues: Issue[];
}
export const sha256 = (value: string | Uint8Array): string =>
	createHash('sha256').update(value).digest('hex');
export const canonicalRegistry = (lines: StbLine[]): string =>
	JSON.stringify([...lines].sort((a, b) => a.id - b.id));
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
	await writeFile(`${path}.tmp`, JSON.stringify(value));
	await rename(`${path}.tmp`, path);
}

export class CollectionError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}
export interface CollectorOptions {
	source: string;
	directory: string;
	request: (path: string, signal: AbortSignal) => Promise<Response>;
	intervalMs?: number;
	timeoutMs?: number;
	budgetMs?: number;
	maxAgeMs?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	progress?: (message: string) => void;
}
/** One transport, one in-flight request. Checkpoints contain response bodies, never credentials. */
export async function createCollector(options: CollectorOptions) {
	const now = options.now ?? Date.now;
	const sleep =
		options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const started = now();
	const deadline = started + (options.budgetMs ?? 3 * 60 * 60_000);
	const timeout = options.timeoutMs ?? 15_000;
	const maxAge = options.maxAgeMs ?? 6 * 60 * 60_000;
	const interval = options.intervalMs ?? 100;
	await mkdir(options.directory, { recursive: true });
	const identity = { version: 1, source: options.source };
	const identityPath = join(options.directory, 'identity.json');
	try {
		const previous = JSON.parse(await readFile(identityPath, 'utf8'));
		if (JSON.stringify(previous) !== JSON.stringify(identity))
			throw new Error('Incompatible checkpoint source/version');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		await writeJsonAtomic(identityPath, identity);
	}
	let lastRequest = -Infinity;
	const evidence = new Map<string, ResponseEvidence>();
	async function get(path: string, fresh = false): Promise<Uint8Array> {
		const cachePath = join(options.directory, `${sha256(path)}.json`);
		if (!fresh) {
			try {
				const cached = JSON.parse(await readFile(cachePath, 'utf8')) ?? {};
				const body =
					typeof cached.body === 'string' ? Buffer.from(cached.body, 'base64') : new Uint8Array();
				const age = now() - Date.parse(cached.capturedAt);
				if (
					body.length &&
					cached.path === path &&
					age >= 0 &&
					age < maxAge &&
					transitDay(Date.parse(cached.capturedAt)) === transitDay(now()) &&
					cached.sha256 === sha256(body)
				) {
					evidence.set(path, { path, sha256: cached.sha256, capturedAt: cached.capturedAt });
					return body;
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
					throw error;
			}
		}
		for (let attempt = 0; attempt < 3; attempt++) {
			if (now() >= deadline)
				throw new CollectionError('budget', 'Collection time budget exhausted');
			const spacing = interval - (now() - lastRequest);
			if (spacing > 0) await sleep(spacing);
			if (now() >= deadline)
				throw new CollectionError('budget', 'Collection time budget exhausted');
			const controller = new AbortController();
			const timer = setTimeout(
				() => controller.abort(),
				Math.min(timeout, Math.max(1, deadline - now()))
			);
			const timedOut = new Promise<never>((_, reject) =>
				controller.signal.addEventListener('abort', () => reject(new Error('Request timeout')), {
					once: true
				})
			);
			let retryDelay = 500 * 2 ** attempt;
			try {
				lastRequest = now();
				const response = await Promise.race([options.request(path, controller.signal), timedOut]);
				if (
					response.status === 401 ||
					response.status === 403 ||
					response.headers.get('X-Proxy-Error')?.startsWith('auth')
				) {
					throw new CollectionError('auth', `Authentication failed (HTTP ${response.status})`);
				}
				if (!response.ok) {
					const retryAfter = response.headers.get('retry-after');
					if (retryAfter) {
						const seconds = Number(retryAfter);
						retryDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now();
						if (!Number.isFinite(retryDelay) || retryDelay < 0) retryDelay = 500;
					}
					// A raw upstream 412 can be transient after the proxy's token refresh.
					// Explicit proxy auth failures above remain immediately fatal.
					if (response.status !== 412 && response.status !== 429 && response.status < 500)
						throw new CollectionError('http', `HTTP ${response.status}`);
					await Promise.race([response.body?.cancel(), timedOut]);
					if (attempt === 2)
						throw new CollectionError(
							response.status === 412 ? 'auth' : 'http',
							response.status === 412
								? 'Authentication failed (HTTP 412 after retries)'
								: `HTTP ${response.status} after retries`
						);
				} else {
					const body = new Uint8Array(await Promise.race([response.arrayBuffer(), timedOut]));
					if (!body.length) throw new CollectionError('empty', 'Empty HTTP 200 response');
					const entry = { path, sha256: sha256(body), capturedAt: new Date(now()).toISOString() };
					evidence.set(path, entry);
					await writeJsonAtomic(cachePath, {
						...entry,
						body: Buffer.from(body).toString('base64')
					});
					return body;
				}
			} catch (error) {
				if (error instanceof CollectionError) throw error;
				if (attempt === 2)
					throw new CollectionError(
						controller.signal.aborted ? 'timeout' : 'network',
						'Request failed after retries'
					);
			} finally {
				clearTimeout(timer);
			}
			if (now() + retryDelay >= deadline)
				throw new CollectionError('budget', 'Retry exceeds collection budget');
			await sleep(retryDelay);
		}
		throw new CollectionError('network', 'Request failed');
	}
	return {
		get,
		evidence,
		source: options.source,
		startedAt: new Date(started).toISOString(),
		now,
		progress: options.progress
	};
}
export type Collector = Awaited<ReturnType<typeof createCollector>>;
export function issueFrom(error: unknown, path: string): Issue {
	return {
		code: error instanceof CollectionError ? error.code : 'schema',
		path,
		message: error instanceof Error ? error.message : String(error)
	};
}

/** Enumerate independently of the bundled catalog, then check registry stability. */
export async function collectTopology(
	collector: Collector,
	source: string
): Promise<TopologySnapshot> {
	const snapshot: TopologySnapshot = {
		schemaVersion: 1,
		status: 'inconclusive',
		source,
		startedAt: collector.startedAt,
		completedAt: '',
		registry: [],
		lines: [],
		stops: [],
		evidence: [],
		issues: []
	};
	const stops = new Map<number, StbStop>();
	const registryPath = '/lines?lang=ro';
	try {
		snapshot.registry = decodeLineRegistry(await collector.get(registryPath, true));
		for (const [index, line] of snapshot.registry.entries()) {
			collector.progress?.(
				`Topology ${index + 1}/${snapshot.registry.length}: ${line.name} (${line.id})`
			);
			if (!line.type)
				snapshot.issues.push({
					code: 'unknown-type',
					path: `line:${line.id}`,
					message: line.rawType
				});
			const result = {
				id: line.id,
				directions: { '0': [] as number[], '1': [] as number[] },
				allStopIds: [] as number[]
			};
			let success = true;
			for (const direction of ['all', '0', '1'] as const) {
				const path = `/lines/${line.id}${direction === 'all' ? '' : `/direction/${direction}`}?lang=ro`;
				try {
					const detail = decodeLineTopology(await collector.get(path));
					if (detail.id !== line.id || detail.name !== line.name || detail.rawType !== line.rawType)
						throw new Error('Registry/detail identity mismatch');
					const ids = [...new Set(detail.stops.map((stop) => stop.id))];
					if (direction === 'all') result.allStopIds = ids;
					else result.directions[direction] = ids;
					for (const stop of detail.stops) {
						const previous = stops.get(stop.id);
						if (
							previous &&
							(previous.name !== stop.name ||
								Math.abs(previous.lat - stop.lat) > 0.00001 ||
								Math.abs(previous.lon - stop.lon) > 0.00001)
						) {
							snapshot.issues.push({
								code: 'stop-conflict',
								path,
								message: `Conflicting identity/coordinates for stop ${stop.id}`
							});
						} else stops.set(stop.id, stop);
					}
				} catch (error) {
					success = false;
					snapshot.issues.push(issueFrom(error, path));
					if (error instanceof CollectionError && ['auth', 'budget'].includes(error.code))
						throw error;
				}
			}
			const union = new Set([...result.directions['0'], ...result.directions['1']]);
			if (
				success &&
				(union.size !== result.allStopIds.length || result.allStopIds.some((id) => !union.has(id)))
			) {
				snapshot.issues.push({
					code: 'direction-coverage',
					path: `line:${line.id}`,
					message: 'Combined detail differs from direction union'
				});
			}
			snapshot.lines.push(result);
		}
		const finalRegistry = decodeLineRegistry(await collector.get(registryPath, true));
		if (canonicalRegistry(finalRegistry) !== canonicalRegistry(snapshot.registry))
			snapshot.issues.push({
				code: 'registry-changed',
				path: registryPath,
				message: 'Registry changed during capture'
			});
	} catch (error) {
		snapshot.issues.push(issueFrom(error, registryPath));
	}
	snapshot.completedAt = new Date(collector.now()).toISOString();
	snapshot.stops = [...stops.values()].sort((a, b) => a.id - b.id);
	snapshot.evidence = [...collector.evidence.values()];
	// Include the earliest cached response in the observation interval when resuming.
	snapshot.startedAt = [
		snapshot.startedAt,
		...snapshot.evidence.map((e) => e.capturedAt)
	].sort()[0];
	if (transitDay(Date.parse(snapshot.startedAt)) !== transitDay(Date.parse(snapshot.completedAt))) {
		snapshot.issues.push({
			code: 'transit-day-changed',
			path: registryPath,
			message: 'Capture crossed the 04:00 Europe/Bucharest service boundary'
		});
	}
	snapshot.status =
		snapshot.issues.length === 0 &&
		snapshot.registry.length > 0 &&
		snapshot.lines.length === snapshot.registry.length
			? 'complete'
			: 'inconclusive';
	return snapshot;
}
