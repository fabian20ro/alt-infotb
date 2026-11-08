import { describe, expect, it, vi } from 'vitest';
import { acquireShellReader } from './shell-reader';
import { shellLifecycleLock, shellReaderLock } from './shell-protocol';

const scope = 'https://localhost/alt-infotb/';

describe('document shell reader', () => {
	it('finishes startup while retaining the reader and releasing the lifecycle gate', async () => {
		const held = new Set<string>();
		const request = vi.fn(async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
			held.add(name);
			try { return await callback({ name, mode: options.mode ?? 'exclusive' }); }
			finally { held.delete(name); }
		}) as unknown as LockManager['request'];
		await acquireShellReader({ request }, scope, 'a');
		expect(held).toEqual(new Set([shellReaderLock(scope, 'a')]));
		// A newer document can start, without releasing the older document's assets.
		await acquireShellReader({ request }, scope, 'b');
		expect(held).toEqual(new Set([shellReaderLock(scope, 'a'), shellReaderLock(scope, 'b')]));
		expect(held.has(shellLifecycleLock(scope))).toBe(false);
	});

	it('cannot enter the reader protocol until an ongoing collection releases its gate', async () => {
		let unblock!: () => void;
		const gate = new Promise<void>(resolve => { unblock = resolve; });
		const seen: string[] = [];
		const request = (async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
			seen.push(name);
			if (name === shellLifecycleLock(scope)) await gate;
			return callback({ name, mode: options.mode ?? 'exclusive' });
		}) as LockManager['request'];
		const startup = acquireShellReader({ request }, scope, 'a');
		await Promise.resolve();
		expect(seen).toEqual([shellLifecycleLock(scope)]);
		unblock(); await startup;
		expect(seen).toEqual([shellLifecycleLock(scope), shellReaderLock(scope, 'a')]);
	});

	it('reports reader acquisition failure instead of claiming a protected document', async () => {
		const request = (async (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
			if (name === shellReaderLock(scope, 'a')) throw new Error('Locks denied');
			return callback({ name, mode: options.mode ?? 'exclusive' });
		}) as LockManager['request'];
		await expect(acquireShellReader({ request }, scope, 'a')).rejects.toThrow('Locks denied');
	});

	it.each(['', '../foreign', 'a:b', 'x'.repeat(129)])('rejects invalid version %s before taking any lock', async version => {
		const request = vi.fn() as unknown as LockManager['request'];
		await expect(acquireShellReader({ request }, scope, version)).rejects.toThrow('Invalid offline shell version');
		expect(request).not.toHaveBeenCalled();
	});
});
