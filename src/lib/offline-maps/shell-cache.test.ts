import { describe, expect, it, vi } from 'vitest';
import { createShellCacheManager, emptyShellRegistry, parseShellRegistry, shellCacheName, type ShellCachePorts, type ShellClient, type ShellLock, type ShellRecord, type ShellRegistry } from './shell-cache';
import { shellDocumentLock, shellReaderLock } from './shell-protocol';

const scope = 'http://localhost/alt-infotb/';
function record(version: string): ShellRecord {
	const homeKey = `${scope}?__WB_REVISION__=${version}`;
	return { version, cacheName: shellCacheName(scope, version), homeKey, keys: [homeKey, `${scope}_app/immutable/${version}.js`], fingerprint: version.charCodeAt(0).toString(16).padStart(2, '0').repeat(32) };
}
const a = record('a'), b = record('b');
const tokenA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tokenB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function readerLocks(version: string, token: string, clientId: string): ShellLock[] {
	return [{ name: shellReaderLock(scope, version), clientId, mode: 'shared' },
		{ name: shellDocumentLock(scope, version, token), clientId, mode: 'exclusive' }];
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
	const state = {
		registry: { schema: 1, scope, active: 'b', owned: [a, b], pins: [], readers: [{ clientId: 'client-b', version: 'b', token: tokenB }] } as ShellRegistry | undefined,
		names: new Set([a.cacheName, b.cacheName]),
		complete: new Set(['a', 'b']),
		clients: [{ id: 'client-b', url: scope }] as ShellClient[],
		held: readerLocks('b', tokenB, 'opaque-lock-client-b'),
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
		await manager.status(client, 'a', 1, tokenA);
		expect(state.registry!.pins).toHaveLength(1);
		state.held.push(...readerLocks('a', tokenA, 'different-opaque-lock-client-a'));
		await manager.status(client, 'a', 0, tokenA);
		expect(state.registry!.pins).toHaveLength(1);
		await manager.status({ ...client, url: 'http://localhost/other/' }, 'a', 1, tokenA);
		expect(state.registry!.pins).toHaveLength(1);
		expect((await manager.status(client, 'a', 1, tokenA)).cleanup.deleted).toEqual([]);
		expect(state.registry!.pins).toEqual([]);
		expect(state.registry!.readers).toContainEqual({ clientId: 'client-a', version: 'a', token: tokenA });
		state.clients.pop(); state.held.splice(-2);
		expect((await manager.cleanup()).deleted).toEqual([a.cacheName]);
		expect(state.registry!.readers).toEqual([{ clientId: 'client-b', version: 'b', token: tokenB }]);
	});
	it('serves the durable current shell even when an obsolete worker handles a queued navigation', async () => {
		const { state, ports } = fixture();
		state.activeWorker = false;
		const served = await createShellCacheManager(scope, a, ports).navigation('new-b', async shell => shell.version);
		expect(served).toBe('b');
		expect(state.registry!.pins).toEqual([{ clientId: 'new-b', version: 'b' }]);
	});
	it('preserves the SW-client binding across worker restarts despite different Web Locks IDs', async () => {
		const { state, ports, manager } = fixture();
		const client = { id: 'service-worker-client-a', url: scope };
		state.clients.push(client);
		state.held.push(...readerLocks('a', tokenA, 'unrelated-web-locks-client-a'));
		state.registry!.pins.push({ clientId: client.id, version: 'a' });
		await manager.status(client, 'a', 1, tokenA);
		const restarted = createShellCacheManager(scope, b, ports);
		expect((await restarted.cleanup()).deferred).toBe(null);
		expect(state.names.has(a.cacheName)).toBe(true);
		expect(state.registry!.pins).toEqual([]);
		state.clients.pop(); state.held.splice(-2);
		expect((await restarted.cleanup()).deleted).toEqual([a.cacheName]);
		expect(state.registry!.readers.some(reader => reader.clientId === client.id)).toBe(false);
	});
	it('rejects a guessed token and a proof/version lock pair held by different opaque clients', async () => {
		const { state, manager } = fixture();
		const client = { id: 'unconfirmed-a', url: scope };
		state.clients.push(client);
		state.registry!.pins.push({ clientId: client.id, version: 'a' });
		expect((await manager.status(client, 'a', 1, tokenA)).cleanup.deferred).toBe('unknown-client');
		const locks = readerLocks('a', tokenA, 'lock-a'); locks[1].clientId = 'different-lock-client';
		state.held.push(...locks);
		expect((await manager.status(client, 'a', 1, tokenA)).cleanup.deferred).toBe('unknown-client');
		expect(state.registry!.readers.some(reader => reader.clientId === client.id)).toBe(false);
		expect(state.registry!.pins).toHaveLength(1);
	});
	it('never rebinds a live document token to another SW client', async () => {
		const { state, manager } = fixture();
		const claimant = { id: 'another-client', url: scope }; state.clients.push(claimant);
		state.registry!.pins.push({ clientId: claimant.id, version: 'b' });
		expect((await manager.status(claimant, 'b', 1, tokenB)).cleanup.deferred).toBe('unknown-client');
		expect(state.registry!.readers).toEqual([{ clientId: 'client-b', version: 'b', token: tokenB }]);
		expect(state.registry!.pins).toHaveLength(1);
	});
	it('prunes dead reader bindings without treating them as permission to clear navigation pins', async () => {
		const { state, manager } = fixture();
		state.registry!.readers.push({ clientId: 'closed-a', version: 'a', token: tokenA });
		state.registry!.pins.push({ clientId: 'closed-a', version: 'a' });
		expect((await manager.cleanup()).deleted).toEqual([]);
		expect(state.registry!.readers).toHaveLength(1);
		expect(state.registry!.pins).toEqual([{ clientId: 'closed-a', version: 'a' }]);
	});
	it('rejects duplicate reader tokens and malformed token metadata', () => {
		const { state } = fixture();
		const duplicate = structuredClone(state.registry!);
		duplicate.readers.push({ clientId: 'another-client', version: 'b', token: tokenB });
		expect(() => parseShellRegistry(duplicate, scope)).toThrow('Invalid offline shell registry');
		duplicate.readers = [{ clientId: 'client-b', version: 'b', token: 'not-a-token' }];
		expect(() => parseShellRegistry(duplicate, scope)).toThrow('Invalid offline shell registry');
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
		expect((await manager.status()).complete).toBe(false);
		ports.read = async () => ({ ...emptyShellRegistry(scope), active: 'missing' });
		expect(await manager.cleanup()).toMatchObject({ deleted: [], deferred: 'unavailable' });
		expect((await manager.status()).complete).toBe(false);
	});
	it('does not advertise offline readiness when the reader handoff cannot be persisted', async () => {
		const { state, manager, ports } = fixture();
		state.registry!.pins.push({ clientId: 'client-b', version: 'b' });
		ports.write = async () => { throw new Error('quota'); };
		expect(await manager.status(state.clients[0], 'b', 1, tokenB)).toMatchObject({ complete: false, cleanup: { deferred: 'unavailable' } });
		expect(state.registry!.pins).toHaveLength(1);
	});
	it('repairs a failed activation commit after worker restart before reporting readiness or serving HTML', async () => {
		const { state, ports } = fixture();
		state.registry!.active = 'a';
		const write = ports.write;
		ports.write = async () => { throw new Error('interrupted activation'); };
		await expect(createShellCacheManager(scope, b, ports).activate(async () => {})).rejects.toThrow('interrupted activation');
		expect(state.registry!.active).toBe('a');
		expect((await createShellCacheManager(scope, b, ports).status()).complete).toBe(false);
		ports.write = write;
		const restarted = createShellCacheManager(scope, b, ports);
		expect(await restarted.navigation('boot-b', async shell => shell.version)).toBe('b');
		expect(state.registry!.active).toBe('b');
		expect((await restarted.status()).complete).toBe(true);
	});
	it('keeps readiness when only old-cache reclamation fails', async () => {
		const { manager, ports } = fixture();
		ports.remove = async () => { throw new Error('old cache busy'); };
		expect(await manager.status()).toMatchObject({ complete: true, cleanup: { deferred: 'unavailable' } });
	});
	it('rejects active metadata whose declared entry differs from the compiled shell', async () => {
		const { state, manager } = fixture();
		state.registry = structuredClone(state.registry);
		const current = state.registry!.owned.find(shell => shell.version === 'b')!;
		current.homeKey = `${scope}?__WB_REVISION__=wrong`;
		current.keys[0] = current.homeKey;
		expect((await manager.status()).complete).toBe(false);
		await expect(manager.navigation('boot-b', async () => 'wrong')).rejects.toThrow('Active offline shell unavailable');
	});
	it('rejects foreign or malformed deletion records', () => {
		const valid = { schema: 1, scope, active: 'b', owned: [b], pins: [], readers: [] };
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
