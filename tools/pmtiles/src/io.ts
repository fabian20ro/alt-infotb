import { createHash } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { copyFile, lstat, readdir, rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

export async function hashFile(filename: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(filename)) hash.update(chunk);
	return hash.digest('hex');
}
export async function checkFile(filename: string, expected: { bytes: number; sha256: string }): Promise<void> {
	const info = await lstat(filename);
	if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes || await hashFile(filename) !== expected.sha256) {
		throw new Error(`Pinned file mismatch: ${path.basename(filename)}`);
	}
}
export async function filesBelow(directory: string): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filename = path.join(directory, entry.name);
		if (entry.isDirectory()) result.push(...await filesBelow(filename));
		else if (entry.isFile()) result.push(filename);
		else throw new Error(`Non-file package entry: ${entry.name}`);
	}
	return result.sort();
}
/** Local extraction results enter the cache only after a complete, checked copy. */
export async function copyPinned(source: string, destination: string, expected: { bytes: number; sha256: string }): Promise<void> {
	try { await checkFile(destination, expected); return; }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
	const partial = `${destination}.${process.pid}.${crypto.randomUUID()}.partial`;
	try {
		await checkFile(source, expected);
		await copyFile(source, partial, constants.COPYFILE_EXCL);
		await checkFile(partial, expected);
		await rename(partial, destination);
	} finally { await rm(partial, { force: true }); }
}
/** A failed or oversized transfer never becomes a cache hit. */
export async function downloadPinned(url: string, destination: string, expected: { bytes: number; sha256: string }): Promise<void> {
	try { await stat(destination); await checkFile(destination, expected); return; }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
	const partial = `${destination}.${process.pid}.${crypto.randomUUID()}.partial`;
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(180_000), redirect: 'error' });
		if (!response.ok || !response.body) throw new Error(`Source download failed: HTTP ${response.status}`);
		let bytes = 0;
		await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
			new Transform({ transform(chunk, _encoding, done) {
				bytes += chunk.length;
				done(bytes > expected.bytes ? new Error('Source exceeds pinned byte count') : null, chunk);
			} }), createWriteStream(partial, { flags: 'wx' }));
		await checkFile(partial, expected);
		await rename(partial, destination);
	} finally { await rm(partial, { force: true }); }
}
export function canonicalPath(filename: string): string {
	return filename.split(path.sep).map(part => encodeURIComponent(part).replaceAll('%40', '@')).join('/');
}
