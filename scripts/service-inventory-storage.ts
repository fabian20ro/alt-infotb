import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateServiceInventoryHistory, type ServiceInventory } from './service-inventory.ts';

export const SERVICE_INVENTORY_REF = 'refs/heads/data/service-inventory';
const HISTORY_FILE = 'service-inventory.json';

interface StorageLocation { cwd?: string; remote?: string }
export interface RestoreInventoryOptions extends StorageLocation { outputPath: string }
export interface SaveInventoryOptions extends StorageLocation { inputPath: string; expectedHead: string | null }

class GitStorageError extends Error {
	constructor(operation: string, code: number | null) {
		// Do not echo command arguments/stderr: credential-bearing remote URLs can appear there.
		super(`Inventory Git ${operation} failed (exit ${code ?? 'signal'}); history was not reset`);
	}
}

async function git(options: StorageLocation, args: string[], input?: string): Promise<{ code: number | null; output: string }> {
	return new Promise((resolveResult, reject) => {
		const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
			cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'],
			env: {
				...process.env, GIT_TERMINAL_PROMPT: '0',
				GIT_AUTHOR_NAME: 'STB service inventory', GIT_AUTHOR_EMAIL: 'service-inventory@users.noreply.github.com',
				GIT_COMMITTER_NAME: 'STB service inventory', GIT_COMMITTER_EMAIL: 'service-inventory@users.noreply.github.com'
			}
		});
		let output = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => { output += chunk; });
		// Drain stderr without exposing authentication material from a configured remote.
		child.stderr.resume();
		child.on('error', reject);
		child.on('close', (code) => resolveResult({ code, output }));
		child.stdin.on('error', () => { /* A failed Git process may close stdin early. */ });
		child.stdin.end(input);
	});
}

async function checkedGit(options: StorageLocation, operation: string, args: string[], input?: string): Promise<string> {
	const result = await git(options, args, input);
	if (result.code !== 0) throw new GitStorageError(operation, result.code);
	return result.output.trim();
}

function isObjectId(value: string): boolean { return /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(value); }

async function remoteHead(options: StorageLocation): Promise<string | null> {
	const result = await git(options, ['ls-remote', '--exit-code', '--refs', '--', options.remote ?? 'origin', SERVICE_INVENTORY_REF]);
	if (result.code === 2 && !result.output.trim()) return null;
	if (result.code !== 0) throw new GitStorageError('read remote reference', result.code);
	const match = result.output.trim().split(/\s+/);
	if (match.length !== 2 || !isObjectId(match[0]) || match[1] !== SERVICE_INVENTORY_REF) {
		throw new Error('Invalid inventory remote reference response');
	}
	return match[0];
}

async function readHistoryAt(options: StorageLocation, head: string): Promise<ServiceInventory> {
	await checkedGit(options, 'fetch history', ['fetch', '--no-tags', '--no-write-fetch-head', '--', options.remote ?? 'origin', head]);
	const tree = await checkedGit(options, 'inspect history tree', ['ls-tree', head]);
	if (!/^100644 blob [0-9a-f]+\tservice-inventory\.json$/.test(tree)) {
		throw new Error('Inventory branch must contain only service-inventory.json');
	}
	const content = await checkedGit(options, 'read history', ['show', `${head}:${HISTORY_FILE}`]);
	return parseHistory(content);
}

function parseHistory(content: string): ServiceInventory {
	return validateServiceInventoryHistory(JSON.parse(content));
}

/** Stable object-key ordering avoids commits caused only by JSON formatting. */
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
	}
	return value;
}

async function atomicWrite(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try { await writeFile(temporary, content); await rename(temporary, path); }
	finally { await rm(temporary, { force: true }); }
}

/** Missing refs are an explicit first run; all other remote/read errors preserve local history. */
export async function restoreInventoryHistory(options: RestoreInventoryOptions): Promise<string | null> {
	const head = await remoteHead(options);
	const outputPath = resolve(options.cwd ?? process.cwd(), options.outputPath);
	if (head === null) { await rm(outputPath, { force: true }); return null; }
	const history = await readHistoryAt(options, head);
	await atomicWrite(outputPath, `${JSON.stringify(history, null, 2)}\n`);
	return head;
}

/** Write Git objects directly: no checkout, index update, main-branch commit, or global identity change. */
export async function saveInventoryHistory(options: SaveInventoryOptions): Promise<string> {
	if (options.expectedHead !== null && !isObjectId(options.expectedHead)) throw new Error('Invalid expected inventory head');
	const history = parseHistory(await readFile(resolve(options.cwd ?? process.cwd(), options.inputPath), 'utf8'));
	const head = await remoteHead(options);
	if (head !== options.expectedHead) throw new Error('Inventory history changed concurrently; restore and merge observations before saving');
	const serialized = `${JSON.stringify(canonical(history), null, 2)}\n`;
	if (head !== null) {
		const previous = await readHistoryAt(options, head);
		if (history.source !== previous.source || history.captures.length < previous.captures.length ||
			previous.captures.some((capture, index) => history.captures[index].captureId !== capture.captureId)) {
			throw new Error('Inventory history must preserve every previously stored capture in order');
		}
		if (JSON.stringify(canonical(previous)) === JSON.stringify(canonical(history))) return head;
	}
	const blob = await checkedGit(options, 'write history object', ['hash-object', '-w', '--stdin'], serialized);
	const tree = await checkedGit(options, 'write history tree', ['mktree'], `100644 blob ${blob}\t${HISTORY_FILE}\n`);
	const commit = await checkedGit(options, 'write history commit', ['commit-tree', tree, ...(head ? ['-p', head] : [])], 'data: preserve observed STB service inventory\n');
	await checkedGit(options, 'publish history with lease', [
		'push', `--force-with-lease=${SERVICE_INVENTORY_REF}:${head ?? ''}`, '--',
		options.remote ?? 'origin', `${commit}:${SERVICE_INVENTORY_REF}`
	]);
	return commit;
}
