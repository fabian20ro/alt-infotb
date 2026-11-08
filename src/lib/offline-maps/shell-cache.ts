import { isShellVersion, shellReaderLock } from './shell-protocol';

export interface ShellRecord {
	version: string;
	cacheName: string;
	homeKey: string;
	keys: string[];
	fingerprint: string;
}
export interface ShellRegistry {
	schema: 1;
	scope: string;
	active: string | null;
	owned: ShellRecord[];
	pins: Array<{ clientId: string; version: string }>;
}
export interface ShellClient { id: string; url: string }
export interface ShellLock { name?: string; clientId?: string; mode?: string }
export interface ShellCleanup {
	deleted: string[];
	retained: string[];
	deferred: null | 'unavailable' | 'replacement' | 'incomplete' | 'unknown-client';
}
export interface ShellCachePorts {
	lifecycle<T>(action: () => Promise<T>): Promise<T>;
	read(): Promise<unknown>;
	write(value: ShellRegistry): Promise<void>;
	names(): Promise<string[]>;
	remove(name: string): Promise<boolean>;
	complete(record: ShellRecord): Promise<boolean>;
	clients(): Promise<ShellClient[]>;
	held(): Promise<ShellLock[]>;
	replacement(): boolean;
	activeWorker(): boolean;
	tryExclusive(version: string, action: () => Promise<void>): Promise<boolean>;
}
export const shellCachePrefix = (scope: string) => `alt-infotb-preview-${encodeURIComponent(new URL(scope).pathname)}`;
export const shellCacheName = (scope: string, version: string) => `${shellCachePrefix(scope)}-precache-v2-${version}`;
export function inShellScope(scope: string, url: string): boolean {
	try { const candidate = new URL(url); return candidate.origin === new URL(scope).origin && candidate.href.startsWith(scope); }
	catch { return false; }
}
export function emptyShellRegistry(scope: string): ShellRegistry { return { schema: 1, scope, active: null, owned: [], pins: [] }; }

/** Unknown/corrupt ownership is never authority to delete a cache. */
export function parseShellRegistry(value: unknown, scope: string): ShellRegistry {
	const bad = () => { throw new Error('Invalid offline shell registry'); };
	if (!value || typeof value !== 'object') return bad();
	const r = value as ShellRegistry;
	if (r.schema !== 1 || r.scope !== scope || !Array.isArray(r.owned) || !Array.isArray(r.pins)
		|| r.owned.length > 1000 || r.pins.length > 10000 || (r.active !== null && !isShellVersion(r.active))) return bad();
	const versions = new Set<string>();
	for (const shell of r.owned) {
		if (!shell || !isShellVersion(shell.version) || versions.has(shell.version)
			|| shell.cacheName !== shellCacheName(scope, shell.version) || !/^[a-f0-9]{64}$/.test(shell.fingerprint)
			|| !Array.isArray(shell.keys) || !shell.keys.length || shell.keys.length > 5000
			|| !shell.keys.every(key => typeof key === 'string' && inShellScope(scope, key))
			|| !shell.keys.includes(shell.homeKey) || new URL(shell.homeKey).pathname !== new URL(scope).pathname) return bad();
		versions.add(shell.version);
	}
	if (r.active !== null && !versions.has(r.active)) return bad();
	if (!r.pins.every(pin => pin && typeof pin.clientId === 'string' && pin.clientId.length > 0
		&& pin.clientId.length <= 256 && versions.has(pin.version))) return bad();
	return r;
}

/** Owns only preview shell metadata. Package archives/assets and raster caches are outside this boundary. */
export function createShellCacheManager(scope: string, own: ShellRecord, ports: ShellCachePorts) {
	const read = async () => parseShellRegistry(await ports.read(), scope);
	const report = (deferred: ShellCleanup['deferred'] = null): ShellCleanup => ({ deleted: [], retained: [], deferred });
	function heldReader(held: ShellLock[], clientId: string, version: string) {
		return held.some(lock => lock.clientId === clientId && lock.mode === 'shared' && lock.name === shellReaderLock(scope, version));
	}
	async function install(action: () => Promise<unknown>) {
		return ports.lifecycle(async () => {
			const raw = await ports.read();
			const registry = raw === undefined ? emptyShellRegistry(scope) : parseShellRegistry(raw, scope);
			const existing = registry.owned.find(record => record.version === own.version);
			// Reusing a label for changed bytes would mutate a cache still read by old tabs.
			if (existing && existing.fingerprint !== own.fingerprint) throw new Error('Offline shell version already owns different bytes');
			if (!existing && (await ports.names()).includes(own.cacheName)) throw new Error('Offline shell cache has unknown ownership');
			registry.owned = [...registry.owned.filter(record => record.version !== own.version), own];
			await ports.write(registry);
			// Journal ownership before writes, so interrupted installation is retryable
			// and its partial cache can later be collected without guessing ownership.
			await action();
			if (!await ports.complete(own)) throw new Error('Incomplete offline shell installation');
		});
	}
	async function activate(action: () => Promise<unknown>) {
		return ports.lifecycle(async () => {
			const registry = await read();
			if (!registry.owned.some(record => record.version === own.version && record.fingerprint === own.fingerprint)) throw new Error('Offline shell ownership missing');
			await action();
			if (!await ports.complete(own)) throw new Error('Incomplete active offline shell');
			registry.active = own.version;
			await ports.write(registry);
		});
	}
	async function navigation<T>(clientId: string, serve: (shell: ShellRecord) => Promise<T>): Promise<T> {
		return ports.lifecycle(async () => {
			const registry = await read();
			const active = registry.owned.find(record => record.version === registry.active);
			if (!active) throw new Error('No active offline shell');
			// Persist before returning HTML. matchAll omits reserved navigation clients;
			// a worker restart must not erase this hand-off to the document's reader lock.
			const pin = { clientId: clientId || '*', version: active.version };
			if (!registry.pins.some(p => p.clientId === pin.clientId && p.version === pin.version)) registry.pins.push(pin);
			await ports.write(registry);
			return serve(active);
		});
	}
	async function collectLocked(registry: ShellRegistry): Promise<ShellCleanup> {
		const result = report();
		const names = await ports.names();
		result.retained = names.filter(name => name.startsWith(`${shellCachePrefix(scope)}-precache-v2-`));
		if (!ports.activeWorker() || registry.active !== own.version) { result.deferred = 'unavailable'; return result; }
		if (ports.replacement()) { result.deferred = 'replacement'; return result; }
		if (!await ports.complete(own)) { result.deferred = 'incomplete'; return result; }
		const held = await ports.held();
		const clients = (await ports.clients()).filter(client => inShellScope(scope, client.url));
		if (clients.some(client => !registry.owned.some(shell => heldReader(held, client.id, shell.version)))) {
			result.deferred = 'unknown-client'; return result;
		}
		for (const shell of registry.owned.slice()) {
			if (shell.version === registry.active || registry.pins.some(pin => pin.version === shell.version)) continue;
			const deleted = await ports.tryExclusive(shell.version, async () => {
				// The lifecycle lock serializes protocol install/activation/navigation;
				// the exclusive version lock is the deletion authority, never query() alone.
				if (!ports.activeWorker() || ports.replacement()) return;
				await ports.remove(shell.cacheName);
				registry.owned = registry.owned.filter(record => record.version !== shell.version);
				await ports.write(registry);
				result.deleted.push(shell.cacheName);
			});
			if (deleted && result.deleted.includes(shell.cacheName)) result.retained = result.retained.filter(name => name !== shell.cacheName);
		}
		return result;
	}
	async function status(client?: ShellClient, readerVersion?: unknown, protocol?: unknown) {
		return ports.lifecycle(async () => {
			const complete = await ports.complete(own);
			try {
				const registry = await read();
				if (client && inShellScope(scope, client.url) && protocol === 1 && isShellVersion(readerVersion)
					&& heldReader(await ports.held(), client.id, readerVersion)) {
					const pins = registry.pins.filter(pin => pin.clientId !== client.id || pin.version !== readerVersion);
					if (pins.length !== registry.pins.length) { registry.pins = pins; await ports.write(registry); }
				}
				return { version: own.version, complete, cleanup: await collectLocked(registry) };
			} catch { return { version: own.version, complete, cleanup: report('unavailable') }; }
		});
	}
	async function cleanup() {
		return ports.lifecycle(async () => { try { return await collectLocked(await read()); } catch { return report('unavailable'); } });
	}
	return { install, activate, navigation, status, cleanup };
}
