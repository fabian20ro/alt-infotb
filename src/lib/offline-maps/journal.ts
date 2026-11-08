import { emptyJournal, type Generation, type Journal, type ManagerConfig } from './contracts.ts';
import { parseOfflineMapManifest } from './manifest.ts';

function invalid(reason: string): never { throw new Error(`Invalid offline map journal: ${reason}`); }
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(label);
	const result = value as Record<string, unknown>;
	if (Object.keys(result).some(key => !keys.includes(key)) || keys.some(key => !(key in result))) invalid(`${label} fields`);
	return result;
}
export function assertStorageId(value: unknown): asserts value is string {
	if (typeof value !== 'string' || value.length > 240 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value)) invalid('unsafe generation/operation ID');
}
export function assertManagerConfig(config: ManagerConfig): void {
	if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(config.namespace)) invalid('namespace must be an application base path');
	assertStorageId(config.regionId);
}
function generation(value: unknown, config: ManagerConfig): Generation | null {
	if (value === null) return null;
	const source = object(value, ['id', 'manifest', 'manifestSha256'], 'generation');
	assertStorageId(source.id);
	if (typeof source.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.manifestSha256)) invalid('manifest digest');
	const manifest = parseOfflineMapManifest(source.manifest, config.reader);
	if (manifest.regionId !== config.regionId) invalid('foreign region');
	return { id: source.id, manifest, manifestSha256: source.manifestSha256 };
}

/** Validate persisted bytes before their identifiers can authorize any file/cache deletion. */
export function parseJournal(value: unknown, config: ManagerConfig): Journal {
	assertManagerConfig(config);
	if (value === undefined) return emptyJournal();
	const source = object(value, ['schemaVersion', 'active', 'previous', 'candidate', 'pendingRender', 'invalidActive', 'operation', 'garbage'], 'root');
	if (source.schemaVersion !== 1 || typeof source.pendingRender !== 'boolean' || typeof source.invalidActive !== 'boolean') invalid('schema');
	const active = generation(source.active, config), previous = generation(source.previous, config), candidate = generation(source.candidate, config);
	if (!Array.isArray(source.garbage) || source.garbage.length > 2) invalid('garbage');
	const garbage = source.garbage.map(item => { const result = generation(item, config); if (!result) invalid('null garbage'); return result; });
	const all = [active, previous, candidate, ...garbage].filter((item): item is Generation => item !== null);
	if (all.length > 2 || new Set(all.map(item => item.id)).size !== all.length) invalid('generation ownership');
	if ((previous || source.pendingRender || source.invalidActive) && !active) invalid('previous/pending render without active generation');
	let operation: Journal['operation'] = null;
	if (source.operation !== null) {
		const item = object(source.operation, ['id', 'phase', 'cancelled'], 'operation');
		assertStorageId(item.id);
		if (!['downloading', 'verifying', 'deleting'].includes(item.phase as string) || typeof item.cancelled !== 'boolean') invalid('operation');
		operation = { id: item.id, phase: item.phase as NonNullable<Journal['operation']>['phase'], cancelled: item.cancelled };
		if (operation.phase === 'deleting' ? !!(active || previous || candidate) : operation.phase === 'verifying' && !candidate) invalid('operation pointers');
	}
	if (candidate && (!operation || operation.phase === 'deleting')) invalid('candidate without install operation');
	return { schemaVersion: 1, active, previous, candidate, pendingRender: source.pendingRender, invalidActive: source.invalidActive, operation, garbage };
}
