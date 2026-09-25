import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { inventoryCaptureId, updateServiceInventory, type InventoryCapture, type ServiceInventory } from './service-inventory.ts';
import { restoreInventoryHistory, saveInventoryHistory, SERVICE_INVENTORY_REF } from './service-inventory-storage.ts';

const execute = promisify(execFile);
const roots: string[] = [];
const identity = {
	...process.env, GIT_AUTHOR_NAME: 'Storage test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
	GIT_COMMITTER_NAME: 'Storage test', GIT_COMMITTER_EMAIL: 'test@example.invalid'
};
async function git(cwd: string, ...args: string[]): Promise<string> {
	return (await execute('git', ['-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: identity })).stdout.trim();
}
async function setup() {
	const root = await mkdtemp(join(tmpdir(), 'stb-inventory-storage-'));
	roots.push(root);
	const remote = join(root, 'remote.git');
	const cwd = join(root, 'work');
	await mkdir(cwd);
	await git(root, 'init', '--bare', remote);
	await git(cwd, 'init', '-b', 'main');
	await git(cwd, 'remote', 'add', 'origin', remote);
	await writeFile(join(cwd, 'application.txt'), 'original\n');
	await git(cwd, 'add', 'application.txt');
	await git(cwd, 'commit', '-m', 'test application');
	await git(cwd, 'push', 'origin', 'main');
	return { root, cwd, remote, inputPath: join(root, 'input.json'), outputPath: join(root, 'restored.json') };
}
function capture(day: number): InventoryCapture {
	const timestamp = `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`;
	const value: Omit<InventoryCapture, 'captureId'> = {
		source: 'https://info.stb.ro/api/web/v2-6', startedAt: timestamp, completedAt: timestamp,
		registryStatus: 'inconclusive', registry: [], observations: [{
			id: 1036, name: 'N700', rawType: 'BUS', apiStopId: 7428,
			path: '/lines/stop?stop_id=7428', capturedAt: timestamp, sha256: 'a'.repeat(64)
		}], topology: []
	};
	return { ...value, captureId: inventoryCaptureId(value) };
}
function inventory(...days: number[]): ServiceInventory {
	let current: ServiceInventory | undefined;
	for (const day of days) current = updateServiceInventory(current, capture(day));
	return current!;
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('durable service inventory Git storage', () => {
	it('runs the CLI restore/save handshake against a real remote', async () => {
		const options = await setup();
		const script = fileURLToPath(new URL('./store-service-inventory.ts', import.meta.url));
		const headFile = join(options.root, 'head.json');
		const run = (...args: string[]) => execute(process.execPath, [script, ...args], { cwd: options.cwd, env: identity });
		await run('--restore', '--output', options.outputPath, '--head-file', headFile);
		expect(JSON.parse(await readFile(headFile, 'utf8'))).toEqual({ head: null });
		await writeFile(options.inputPath, JSON.stringify(inventory(25)));
		await run('--save', '--input', options.inputPath, '--head-file', headFile);
		await run('--restore', '--output', options.outputPath, '--head-file', headFile);
		expect(JSON.parse(await readFile(headFile, 'utf8'))).toEqual({ head: await git(options.remote, 'rev-parse', SERVICE_INVENTORY_REF) });
		expect(JSON.parse(await readFile(options.outputPath, 'utf8'))).toEqual(inventory(25));
	});
	it('distinguishes a missing history branch and removes only stale requested output', async () => {
		const options = await setup();
		await writeFile(options.outputPath, 'stale history');
		expect(await restoreInventoryHistory(options)).toBeNull();
		await expect(readFile(options.outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
		expect(await git(options.cwd, 'branch', '--show-current')).toBe('main');
	});
	it('initializes and roundtrips history without touching branch, index, worktree, or main', async () => {
		const options = await setup();
		const value = inventory(25);
		await writeFile(options.inputPath, JSON.stringify(value));
		await writeFile(join(options.cwd, 'application.txt'), 'staged change\n');
		await git(options.cwd, 'add', 'application.txt');
		await writeFile(join(options.cwd, 'application.txt'), 'unstaged change\n');
		const before = { status: await git(options.cwd, 'status', '--porcelain'), main: await git(options.cwd, 'rev-parse', 'HEAD'), index: await readFile(join(options.cwd, '.git/index')) };
		const head = await saveInventoryHistory({ ...options, expectedHead: null });
		expect(head).toMatch(/^[a-f\d]{40}$/);
		expect(await restoreInventoryHistory(options)).toBe(head);
		expect(JSON.parse(await readFile(options.outputPath, 'utf8'))).toEqual(value);
		expect(await git(options.remote, 'ls-tree', '--name-only', SERVICE_INVENTORY_REF)).toBe('service-inventory.json');
		expect(await git(options.remote, 'rev-list', '--count', SERVICE_INVENTORY_REF)).toBe('1');
		expect(await git(options.cwd, 'branch', '--show-current')).toBe('main');
		expect(await git(options.cwd, 'rev-parse', 'HEAD')).toBe(before.main);
		expect(await git(options.cwd, 'status', '--porcelain')).toBe(before.status);
		expect(await readFile(join(options.cwd, '.git/index'))).toEqual(before.index);
		expect(await readFile(join(options.cwd, 'application.txt'), 'utf8')).toBe('unstaged change\n');
		expect(await git(options.remote, 'rev-parse', 'main')).toBe(before.main);
	});
	it('does not create another commit for unchanged JSON with different formatting/key order', async () => {
		const options = await setup();
		const value = inventory(25);
		await writeFile(options.inputPath, JSON.stringify(value));
		const head = await saveInventoryHistory({ ...options, expectedHead: null });
		await writeFile(options.inputPath, JSON.stringify({ services: value.services, captures: value.captures, source: value.source, schemaVersion: value.schemaVersion }, null, 4));
		expect(await saveInventoryHistory({ ...options, expectedHead: head })).toBe(head);
		expect(await git(options.remote, 'rev-list', '--count', SERVICE_INVENTORY_REF)).toBe('1');
	});
	it('appends with the previous commit as parent and rejects a stale concurrent writer', async () => {
		const options = await setup();
		await writeFile(options.inputPath, JSON.stringify(inventory(25)));
		const first = await saveInventoryHistory({ ...options, expectedHead: null });
		await writeFile(options.inputPath, JSON.stringify(inventory(25, 26)));
		const second = await saveInventoryHistory({ ...options, expectedHead: first });
		expect(await git(options.remote, 'rev-parse', `${second}^`)).toBe(first);
		await writeFile(options.inputPath, JSON.stringify(inventory(25, 27)));
		await expect(saveInventoryHistory({ ...options, expectedHead: first })).rejects.toThrow('changed concurrently');
		expect(await git(options.remote, 'rev-parse', SERVICE_INVENTORY_REF)).toBe(second);
		await expect(saveInventoryHistory({ ...options, expectedHead: null })).rejects.toThrow('changed concurrently');
	});
	it('rejects valid but truncated or rewritten observation history', async () => {
		const options = await setup();
		await writeFile(options.inputPath, JSON.stringify(inventory(25, 26)));
		const head = await saveInventoryHistory({ ...options, expectedHead: null });
		for (const value of [inventory(26), inventory(25, 27)]) {
			await writeFile(options.inputPath, JSON.stringify(value));
			await expect(saveInventoryHistory({ ...options, expectedHead: head })).rejects.toThrow('preserve every previously stored capture');
		}
		expect(await git(options.remote, 'rev-parse', SERVICE_INVENTORY_REF)).toBe(head);
	});
	it('allows only one concurrent first writer through the remote lease', async () => {
		const options = await setup();
		const otherInput = join(options.root, 'other.json');
		await writeFile(options.inputPath, JSON.stringify(inventory(25)));
		await writeFile(otherInput, JSON.stringify(inventory(26)));
		const results = await Promise.allSettled([
			saveInventoryHistory({ ...options, expectedHead: null }),
			saveInventoryHistory({ ...options, inputPath: otherInput, expectedHead: null })
		]);
		const successes = results.filter((result) => result.status === 'fulfilled');
		expect(successes).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect(await git(options.remote, 'rev-parse', SERVICE_INVENTORY_REF)).toBe(successes[0].value);
		expect(await git(options.remote, 'rev-list', '--count', SERVICE_INVENTORY_REF)).toBe('1');
	});
	it('does not interpret an unreachable remote as missing history or replace local output', async () => {
		const options = await setup();
		await writeFile(options.outputPath, 'existing local history');
		const invalidRemote = join(options.root, 'missing.git');
		await expect(restoreInventoryHistory({ ...options, remote: invalidRemote })).rejects.toThrow('read remote reference failed');
		expect(await readFile(options.outputPath, 'utf8')).toBe('existing local history');
	});
	it('rejects malformed or hash-corrupt candidate history before publishing', async () => {
		const options = await setup();
		await writeFile(options.inputPath, '{}');
		await expect(saveInventoryHistory({ ...options, expectedHead: null })).rejects.toThrow();
		const value = inventory(25);
		value.captures[0].observations[0].name = 'tampered';
		await writeFile(options.inputPath, JSON.stringify(value));
		await expect(saveInventoryHistory({ ...options, expectedHead: null })).rejects.toThrow('capture hash mismatch');
		expect(await restoreInventoryHistory(options)).toBeNull();
	});
	it('rejects corrupted stored JSON and leaves local history untouched', async () => {
		const options = await setup();
		// Create a corrupt data branch in a separate checkout to model remote tampering.
		const writer = join(options.root, 'corrupt');
		await mkdir(writer);
		await git(writer, 'init', '-b', 'data/service-inventory');
		await writeFile(join(writer, 'service-inventory.json'), '{"schemaVersion":999}');
		await git(writer, 'add', 'service-inventory.json');
		await git(writer, 'commit', '-m', 'corrupt history');
		await git(writer, 'push', options.remote, SERVICE_INVENTORY_REF);
		await writeFile(options.outputPath, 'last local valid copy');
		await expect(restoreInventoryHistory(options)).rejects.toThrow('Service inventory');
		expect(await readFile(options.outputPath, 'utf8')).toBe('last local valid copy');
	});
	it('rejects an unexpected file in the dedicated branch', async () => {
		const options = await setup();
		const writer = join(options.root, 'extra-file');
		await mkdir(writer);
		await git(writer, 'init', '-b', 'data/service-inventory');
		await writeFile(join(writer, 'service-inventory.json'), JSON.stringify(inventory(25)));
		await writeFile(join(writer, 'unexpected.txt'), 'wrong branch contents');
		await git(writer, 'add', '.');
		await git(writer, 'commit', '-m', 'unexpected file');
		await git(writer, 'push', options.remote, SERVICE_INVENTORY_REF);
		await expect(restoreInventoryHistory(options)).rejects.toThrow('must contain only service-inventory.json');
	});
});
