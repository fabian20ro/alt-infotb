import { isShellReaderToken, isShellVersion, shellDocumentLock, shellReaderLock } from './shell-protocol';

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
	readers: Array<{ clientId: string; version: string; token: string }>;
}
export interface ShellClient { id: string; url: string }
export interface ShellLock { name?: string; clientId?: string; mode?: string }
export interface ShellCleanup {
	deleted: string[];
	retained: string[];
	deferred: null | 'unavailable' | 'replacement' | 'incomplete' | 'unknown-client';
}
export interface ShellRecoveryAsset {
	url: string;
	key: string;
	integrity: string;
	contentType?: string;
}
export type ShellRecoveryResult = { status: 'ready'; registryReset: boolean }
	| { status: 'busy' | 'replacement' | 'network-required' | 'integrity-error' | 'storage-error' | 'unavailable' };
export interface ShellRecoveryPorts {
	assets: ShellRecoveryAsset[];
	/** Holds the exclusive transition lock and shared own-version lease. */
	tryExclusive<T>(action: () => Promise<T>): Promise<T | null>;
	readAsset(key: string): Promise<Response | undefined>;
	writeAsset(key: string, response: Response): Promise<void>;
	fetchAsset(url: string): Promise<Response>;
}
/** Verifies trusted build bytes; valid responses remain readable by the caller. */
export async function verifyShellResponse(response: Response | undefined, asset: ShellRecoveryAsset): Promise<boolean> {
	if (!response || response.status !== 200 || response.type === 'opaque' || response.type === 'opaqueredirect'
		|| !/^sha256-[A-Za-z0-9+/]{43}=$/.test(asset.integrity)) return false;
	if (asset.contentType && response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== asset.contentType.toLowerCase()) return false;
	try {
		const reader = response.clone().body?.getReader();
		if (!reader) return false;
		const chunks: Uint8Array[] = [];
		let length = 0;
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			length += next.value.byteLength;
			if (length > 8 * 1024 ** 2) {
				// Cancel both tee branches: awaiting only the clone can wait forever
				// for the untouched original response. Oversized bytes are never reused.
				void reader.cancel().catch(() => {});
				void response.body?.cancel().catch(() => {});
				return false;
			}
			chunks.push(next.value);
		}
		const bytes = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
		return `sha256-${btoa(String.fromCharCode(...digest))}` === asset.integrity;
	} catch { return false; }
}
export interface ShellCachePorts {
	recovery?: ShellRecoveryPorts;
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
export function emptyShellRegistry(scope: string): ShellRegistry { return { schema: 1, scope, active: null, owned: [], pins: [], readers: [] }; }

/** Unknown/corrupt ownership is never authority to delete a cache. */
export function parseShellRegistry(value: unknown, scope: string): ShellRegistry {
	const bad = () => { throw new Error('Invalid offline shell registry'); };
	if (!value || typeof value !== 'object') return bad();
	const r = value as ShellRegistry;
	if (r.schema !== 1 || r.scope !== scope || !Array.isArray(r.owned) || !Array.isArray(r.pins) || !Array.isArray(r.readers)
		|| r.owned.length > 1000 || r.pins.length > 10000 || r.readers.length > 10000 || (r.active !== null && !isShellVersion(r.active))) return bad();
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
	const readerClients = new Set<string>(), readerTokens = new Set<string>();
	for (const reader of r.readers) {
		if (!reader || typeof reader.clientId !== 'string' || !reader.clientId.length || reader.clientId.length > 256
			|| !versions.has(reader.version) || !isShellReaderToken(reader.token)
			|| readerClients.has(reader.clientId) || readerTokens.has(reader.token)) return bad();
		readerClients.add(reader.clientId); readerTokens.add(reader.token);
	}
	return r;
}

/** Owns only preview shell metadata. Package archives/assets and raster caches are outside this boundary. */
export function createShellCacheManager(scope: string, own: ShellRecord, ports: ShellCachePorts) {
	const read = async () => parseShellRegistry(await ports.read(), scope);
	function validRecoveryAssets(assets: ShellRecoveryAsset[]): boolean {
		return assets.length === own.keys.length && new Set(assets.map(asset => asset.key)).size === assets.length
			&& assets.every(asset => own.keys.includes(asset.key) && inShellScope(scope, asset.url)
				&& new URL(asset.url).pathname === new URL(asset.key).pathname
				&& /^sha256-[A-Za-z0-9+/]{43}=$/.test(asset.integrity));
	}
	async function shellComplete(record: ShellRecord): Promise<boolean> {
		if (!await ports.complete(record)) return false;
		if (!ports.recovery || record.version !== own.version || record.cacheName !== own.cacheName) return true;
		const { assets, readAsset } = ports.recovery;
		if (!validRecoveryAssets(assets)) return false;
		for (const asset of assets) if (!await verifyShellResponse(await readAsset(asset.key), asset)) return false;
		return true;
	}
	const report = (deferred: ShellCleanup['deferred'] = null): ShellCleanup => ({ deleted: [], retained: [], deferred });
	function heldReader(held: ShellLock[], version: string, token: string) {
		// Browser APIs do not reliably expose the same client ID. Bind a scoped
		// message's SW client to two locks held by one opaque Web Locks client.
		const proof = held.find(lock => lock.mode === 'exclusive' && lock.name === shellDocumentLock(scope, version, token));
		return !!proof?.clientId && held.some(lock => lock.clientId === proof.clientId && lock.mode === 'shared'
			&& lock.name === shellReaderLock(scope, version));
	}
	function ownsCurrent(registry: ShellRegistry) {
		return registry.owned.some(record => record.version === own.version && record.fingerprint === own.fingerprint
			&& record.cacheName === own.cacheName && record.homeKey === own.homeKey
			&& record.keys.length === own.keys.length && record.keys.every((key, index) => key === own.keys[index]));
	}
	async function reconcileActive(registry: ShellRegistry, verifiedComplete?: boolean) {
		// A rejected activate event does not roll back the browser's active worker.
		// Only that actual worker may repair a commit interrupted after activation.
		if (!ports.activeWorker()) return;
		if (!ownsCurrent(registry) || !(verifiedComplete ?? await shellComplete(own))) throw new Error('Active offline shell unavailable');
		if (registry.active !== own.version) {
			registry.active = own.version;
			await ports.write(registry);
		}
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
			if (!await shellComplete(own)) throw new Error('Incomplete offline shell installation');
		});
	}
	async function activate(action: () => Promise<unknown>) {
		return ports.lifecycle(async () => {
			const registry = await read();
			if (!ownsCurrent(registry)) throw new Error('Offline shell ownership missing');
			await action();
			if (!await shellComplete(own)) throw new Error('Incomplete active offline shell');
			registry.active = own.version;
			await ports.write(registry);
		});
	}
	async function navigation<T>(clientId: string, serve: (shell: ShellRecord) => Promise<T>): Promise<T> {
		return ports.lifecycle(async () => {
			const registry = await read();
			await reconcileActive(registry);
			// An obsolete worker has no trusted integrity table for another build.
			// Its standalone fallback must hand recovery to registration.active.
			if (!ports.activeWorker()) throw new Error('Active offline shell unavailable');
			const active = registry.owned.find(record => record.version === registry.active);
			if (!active) throw new Error('No active offline shell');
			// Reconciliation verified this own-version shell under the same lifecycle gate.
			// Persist before returning HTML. matchAll omits reserved navigation clients;
			// a worker restart must not erase this hand-off to the document's reader lock.
			const pin = { clientId: clientId || '*', version: active.version };
			if (!registry.pins.some(p => p.clientId === pin.clientId && p.version === pin.version)) registry.pins.push(pin);
			await ports.write(registry);
			return serve(active);
		});
	}
	async function collectLocked(registry: ShellRegistry, verifiedComplete: boolean): Promise<ShellCleanup> {
		const result = report();
		const names = await ports.names();
		result.retained = names.filter(name => name.startsWith(`${shellCachePrefix(scope)}-precache-v2-`));
		if (!ports.activeWorker() || registry.active !== own.version) { result.deferred = 'unavailable'; return result; }
		if (ports.replacement()) { result.deferred = 'replacement'; return result; }
		if (!verifiedComplete) { result.deferred = 'incomplete'; return result; }
		const held = await ports.held();
		const liveReaders = registry.readers.filter(reader => heldReader(held, reader.version, reader.token));
		if (liveReaders.length !== registry.readers.length) { registry.readers = liveReaders; await ports.write(registry); }
		const clients = (await ports.clients()).filter(client => inShellScope(scope, client.url));
		if (clients.some(client => !registry.readers.some(reader => reader.clientId === client.id))) {
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
				registry.readers = registry.readers.filter(reader => reader.version !== shell.version);
				await ports.write(registry);
				result.deleted.push(shell.cacheName);
			});
			if (deleted && result.deleted.includes(shell.cacheName)) result.retained = result.retained.filter(name => name !== shell.cacheName);
		}
		return result;
	}
	async function status(client?: ShellClient, readerVersion?: unknown, protocol?: unknown, readerToken?: unknown) {
		return ports.lifecycle(async () => {
			const complete = await shellComplete(own);
			let registry: ShellRegistry;
			try {
				registry = await read();
				if (!ownsCurrent(registry)) throw new Error('Offline shell ownership missing');
				if (complete) await reconcileActive(registry, complete);
				if (client && inShellScope(scope, client.url) && protocol === 1 && isShellVersion(readerVersion)
					&& isShellReaderToken(readerToken) && registry.owned.some(record => record.version === readerVersion)) {
					const held = await ports.held();
					const readers = registry.readers.filter(reader => heldReader(held, reader.version, reader.token));
					const existing = readers.find(reader => reader.clientId === client.id);
					const otherOwner = readers.some(reader => reader.token === readerToken && reader.clientId !== client.id);
					if (heldReader(held, readerVersion, readerToken) && !otherOwner
						&& (!existing || (existing.version === readerVersion && existing.token === readerToken))) {
						if (!existing) readers.push({ clientId: client.id, version: readerVersion, token: readerToken });
						const pins = registry.pins.filter(pin => pin.clientId !== client.id || pin.version !== readerVersion);
						if (pins.length !== registry.pins.length || readers.length !== registry.readers.length
							|| readers.some((reader, i) => reader !== registry.readers[i])) {
							registry.pins = pins; registry.readers = readers; await ports.write(registry);
						}
					}
				}
			} catch { return { version: own.version, complete: false, cleanup: report('unavailable') }; }
			// Failing to reclaim an unrelated old cache must not invalidate a healthy
			// active shell. Metadata/readiness failures above remain fail-closed.
			try { return { version: own.version, complete, cleanup: await collectLocked(registry, complete) }; }
			catch { return { version: own.version, complete, cleanup: report('unavailable') }; }
		});
	}
	async function cleanup() {
		return ports.lifecycle(async () => {
			try {
				const registry = await read();
				const complete = await shellComplete(own);
				if (complete) await reconcileActive(registry, complete);
				return await collectLocked(registry, complete);
			} catch { return report('unavailable'); }
		});
	}
	async function recover(): Promise<ShellRecoveryResult> {
		const recovery = ports.recovery;
		if (!recovery || !validRecoveryAssets(recovery.assets)) return { status: 'unavailable' };
		const blocked = (): ShellRecoveryResult | null => !ports.activeWorker() ? { status: 'unavailable' }
			: ports.replacement() ? { status: 'replacement' } : null;
		try {
			return await recovery.tryExclusive(async (): Promise<ShellRecoveryResult> => {
				const initial = await ports.lifecycle(async () => blocked());
				if (initial) return initial;
				for (const asset of recovery.assets) {
					let response = await recovery.readAsset(asset.key);
					if (await verifyShellResponse(response, asset)) continue;
					// Valid local bytes can repair damaged MIME metadata without a network.
					const bytesOnly = { ...asset, contentType: undefined };
					if (!await verifyShellResponse(response, bytesOnly)) {
						// The shared own-version lease protects this cache while the lifecycle
						// gate is free for navigation/install and the network may be unavailable.
						try { response = await recovery.fetchAsset(asset.url); }
						catch { return { status: 'network-required' }; }
						if (!await verifyShellResponse(response, bytesOnly)) return { status: 'integrity-error' };
					}
					if (!response) return { status: 'integrity-error' };
					const repaired = asset.contentType ? new Response(response.body, {
						headers: { 'Content-Type': asset.contentType }
					}) : response;
					const interrupted = await ports.lifecycle(async () => {
						const reason = blocked();
						if (reason) return reason;
						await recovery.writeAsset(asset.key, repaired);
						return null;
					});
					if (interrupted) return interrupted;
				}
				return ports.lifecycle(async (): Promise<ShellRecoveryResult> => {
					const reason = blocked();
					if (reason) return reason;
					if (!await shellComplete(own)) return { status: 'unavailable' };
					let registry: ShellRegistry;
					let registryReset = false;
					// Read again after asynchronous network work; preserve newly added pins.
					try { registry = await read(); if (!ownsCurrent(registry)) throw new Error('Unknown active shell'); }
					catch {
						registryReset = true;
						registry = emptyShellRegistry(scope);
						registry.owned = [own];
						// Lost metadata may have protected a document still bootstrapping.
						// Never infer that document's death from absence in matchAll().
						registry.pins = [{ clientId: '*', version: own.version }];
					}
					registry.active = own.version;
					await ports.write(registry);
					return { status: 'ready', registryReset };
				});
			}) ?? { status: 'busy' };
		} catch { return { status: 'storage-error' }; }
	}
	return { install, activate, navigation, status, cleanup, recover };
}
