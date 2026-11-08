import { describe, expect, it, vi } from 'vitest';
import { createShellCacheManager, emptyShellRegistry, parseShellRegistry, shellCacheName, type ShellCachePorts, type ShellClient, type ShellLock, type ShellRecord, type ShellRegistry } from './shell-cache';
import { shellReaderLock } from './shell-protocol';

const scope = 'http://localhost/alt-infotb/';
function record(version: string): ShellRecord {
	const homeKey = `${scope}?__WB_REVISION__=${version}`;
	return { version, cacheName: shellCacheName(scope, version), homeKey, keys: [homeKey, `${scope}_app/immutable/${version}.js`], fingerprint: version.charCodeAt(0).toString(16).padStart(2, '0').repeat(32) };
}
const a = record('a'), b = record('b');
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
	const state = {
		registry: { schema: 1, scope, active: 'b', owned: [a, b], pins: [] } as ShellRegistry | undefined,
		names: new Set([a.cacheName, b.cacheName]),
		complete: new Set(['a', 'b']),
		clients: [{ id: 'client-b', url: scope }] as ShellClient[],
		held: [{ name: shellReaderLock(scope, 'b'), clientId: 'client-b', mode: 'shared' }] as ShellLock[],
		replacement: false,
		activeWorker: true
	};
	let tail: Promise<unknown> = Promise.resolve();
	const ports: ShellCachePorts = {
		lifecycle<T>(action: () => Promise<T>) { const result = tail.then(action); tail = result.catch(() => {}); return result; },
		read: async () => structuredClone(state.registry),
		write: vi.fn(async value => { state.registry = structuredClone(value); }),
		names: async () => [...state.names],
		remove: vi.fn(async name => state.names.delete(name)),
		complete: async shell => state.names.has(shell.cacheName) && state.complete.has(shell.version),
		clients: async () => state.clients,
		held: async () => state.held,
		replacement: () => state.replacement,
		activeWorker: () => state.activeWorker,
		async tryExclusive(version, action) {
			if (state.held.some(lock => lock.name === shellReaderLock(scope, version))) return false;
			await action(); return true;
		}
	};
	return { state, ports, manager: createShellCacheManager(scope, b, ports) };
}

describe('offline shell cache ownership and reader cleanup', () => {
	it('deletes only owned idle old shells, preserving current, legacy, package and foreign caches', async () => {
		const { state, manager } = fixture();
		const other = ['alt-infotb-offline-v1:package', shellCacheName(scope, 'legacy'), shellCacheName('http://localhost/another/', 'a'), 'carto-v4', 'unrelated-user-data'];
		other.forEach(name => state.names.add(name));
		expect(await manager.cleanup()).toMatchObject({ deleted: [a.cacheName], deferred: null });
		expect([...state.names]).toEqual([b.cacheName, ...other]);
		expect(state.registry!.owned.map(shell => shell.version)).toEqual(['b']);
		expect((await manager.cleanup()).deleted).toEqual([]);
	});
	it('keeps a frozen reader even when it is absent from enumerable window clients', async () => {
		const { state, manager } = fixture();
		state.held.push({ name: shellReaderLock(scope, 'a'), clientId: 'frozen-a', mode: 'shared' });
		expect((await manager.cleanup()).deleted).toEqual([]);
		state.held.pop();
		expect((await manager.cleanup()).deleted).toEqual([a.cacheName]);
	});
	it('uses exclusive ownership at deletion, not an earlier lock query snapshot', async () => {
		const { state, manager, ports } = fixture();
		ports.clients = async () => {
			state.held.push({ name: shellReaderLock(scope, 'a'), clientId: 'late-a', mode: 'shared' });
			return state.clients;
		};
		expect((await manager.cleanup()).deleted).toEqual([]);
		expect(state.names.has(a.cacheName)).toBe(true);
	});
	it('defers while any in-scope window has not acquired a recognized reader lease', async () => {
		const { state, manager } = fixture();
		state.clients.push({ id: 'legacy', url: `${scope}?old` });
		expect(await manager.cleanup()).toMatchObject({ deleted: [], deferred: 'unknown-client' });
		state.clients.pop(); state.clients.push({ id: 'foreign', url: 'http://localhost/another/' });
		expect((await manager.cleanup()).deleted).toEqual([a.cacheName]);
	});
	it.each(['replacement', 'incomplete', 'inactive'] as const)('defers for %s worker state', async condition => {
		const { state, manager } = fixture();
		if (condition === 'replacement') state.replacement = true;
		if (condition === 'incomplete') state.complete.delete('b');
		if (condition === 'inactive') state.activeWorker = false;
		expect((await manager.cleanup()).deleted).toEqual([]);
		expect(state.names.has(a.cacheName)).toBe(true);
	});
	it('keeps unacknowledged navigation pins across worker restarts, including absent client IDs', async () => {
		const { state, ports } = fixture();
		state.registry!.active = 'a';
		await createShellCacheManager(scope, a, ports).navigation('boot-a', async shell => shell.version);
		await createShellCacheManager(scope, a, ports).navigation('', async shell => shell.version);
		state.registry!.active = 'b';
		const restarted = createShellCacheManager(scope, b, ports);
		expect((await restarted.cleanup()).deleted).toEqual([]);
		expect(state.registry!.pins).toEqual([{ clientId: 'boot-a', version: 'a' }, { clientId: '*', version: 'a' }]);
	});
	it('hands a navigation pin to a matching browser-held reader, then collects after its last reader closes', async () => {
		const { state, manager } = fixture();
		state.registry!.pins.push({ clientId: 'client-a', version: 'a' });
		const client = { id: 'client-a', url: scope };
		state.clients.push(client);
		await manager.status(client, 'a', 1);
		expect(state.registry!.pins).toHaveLength(1);
		state.held.push({ name: shellReaderLock(scope, 'a'), clientId: client.id, mode: 'shared' });
		await manager.status(client, 'a', 0);
		expect(state.registry!.pins).toHaveLength(1);
		await manager.status({ ...client, url: 'http://localhost/other/' }, 'a', 1);
		expect(state.registry!.pins).toHaveLength(1);
		expect((await manager.status(client, 'a', 1)).cleanup.deleted).toEqual([]);
		expect(state.registry!.pins).toEqual([]);
		state.clients.pop(); state.held.pop();
		expect((await manager.cleanup()).deleted).toEqual([a.cacheName]);
	});
	it('serves the durable current shell even when an obsolete worker handles a queued navigation', async () => {
		const { state, ports } = fixture();
		const served = await createShellCacheManager(scope, a, ports).navigation('new-b', async shell => shell.version);
		expect(served).toBe('b');
		expect(state.registry!.pins).toEqual([{ clientId: 'new-b', version: 'b' }]);
	});
	it('serializes navigation pin persistence and activation before old-shell collection', async () => {
		const { state, ports, manager } = fixture();
		state.registry!.active = 'a';
		const entered = deferred(), release = deferred();
		const navigation = createShellCacheManager(scope, a, ports).navigation('new-a', async shell => {
			entered.resolve(); await release.promise; return shell.version;
		});
		await entered.promise;
		const activation = manager.activate(async () => {});
		const cleanup = manager.cleanup();
		expect(state.registry!.active).toBe('a');
		release.resolve();
		expect(await navigation).toBe('a'); await activation;
		expect((await cleanup).deleted).toEqual([]);
		expect(state.registry!.active).toBe('b');
		expect(state.names.has(a.cacheName)).toBe(true);
	});
	it('journals ownership before install writes and can retry an interrupted same-version install', async () => {
		const { state, ports } = fixture();
		const c = record('c'), manager = createShellCacheManager(scope, c, ports);
		await expect(manager.install(async () => {
			expect(state.registry!.owned.some(shell => shell.version === 'c')).toBe(true);
			state.names.add(c.cacheName); throw new Error('interrupted');
		})).rejects.toThrow('interrupted');
		expect(state.registry!.active).toBe('b');
		await manager.install(async () => { state.complete.add('c'); });
		await manager.activate(async () => {});
		expect(state.registry!.active).toBe('c');
	});
	it('rejects reused version labels with changed manifests before any cache write', async () => {
		const { state, ports } = fixture();
		const action = vi.fn(async () => {});
		const changed = createShellCacheManager(scope, { ...a, fingerprint: 'f'.repeat(64) }, ports);
		await expect(changed.install(action)).rejects.toThrow('different bytes');
		expect(action).not.toHaveBeenCalled(); expect(state.names.has(a.cacheName)).toBe(true);
	});
	it('does not adopt or overwrite a legacy cache with an identical version label', async () => {
		const { state, ports } = fixture();
		const legacy = record('legacy'); state.names.add(legacy.cacheName);
		const action = vi.fn(async () => {});
		await expect(createShellCacheManager(scope, legacy, ports).install(action)).rejects.toThrow('unknown ownership');
		expect(action).not.toHaveBeenCalled();
	});
	it('failed registry writes prevent both installation mutation and HTML delivery', async () => {
		const { ports, manager } = fixture();
		ports.write = async () => { throw new Error('quota'); };
		const action = vi.fn(async () => {}), serve = vi.fn(async () => new Response());
		await expect(createShellCacheManager(scope, record('c'), ports).install(action)).rejects.toThrow('quota');
		await expect(manager.navigation('new-b', serve)).rejects.toThrow('quota');
		expect(action).not.toHaveBeenCalled(); expect(serve).not.toHaveBeenCalled();
	});
	it('missing/corrupt registry fails closed without claiming legacy cache ownership', async () => {
		const { state, manager, ports } = fixture();
		state.registry = undefined;
		expect(await manager.cleanup()).toMatchObject({ deleted: [], deferred: 'unavailable' });
		ports.read = async () => ({ ...emptyShellRegistry(scope), active: 'missing' });
		expect(await manager.cleanup()).toMatchObject({ deleted: [], deferred: 'unavailable' });
	});
	it('rejects foreign or malformed deletion records', () => {
		const valid = { schema: 1, scope, active: 'b', owned: [b], pins: [] };
		for (const patch of [{ cacheName: 'unrelated-user-data' }, { homeKey: 'http://localhost/foreign/' }, { keys: ['http://evil.test/'] }, { version: '../x' }]) {
			expect(() => parseShellRegistry({ ...valid, owned: [{ ...b, ...patch }] }, scope)).toThrow();
		}
	});
	it('keeps deletion authority in the journal after a failed removal and retries safely', async () => {
		const { state, manager, ports } = fixture();
		const remove = ports.remove; ports.remove = async () => { throw new Error('storage busy'); };
		expect((await manager.cleanup()).deferred).toBe('unavailable');
		expect(state.registry!.owned.map(shell => shell.version)).toContain('a');
		ports.remove = remove;
		expect((await manager.cleanup()).deleted).toEqual([a.cacheName]);
	});
});
