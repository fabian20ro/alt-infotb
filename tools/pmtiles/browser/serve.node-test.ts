import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createPreviewServer } from '../src/serve.ts';

test('preview serves byte ranges, cache validators, bounded CORS and no files outside the package', async () => {
	const temporary = await mkdtemp(path.join(os.tmpdir(), 'pmtiles-preview-'));
	const directory = path.join(temporary, 'package');
	const { mkdir } = await import('node:fs/promises');
	await mkdir(directory);
	await writeFile(path.join(directory, 'test.pmtiles'), '0123456789');
	await writeFile(path.join(temporary, 'private.txt'), 'private');
	await symlink(path.join(temporary, 'private.txt'), path.join(directory, 'escape.txt'));
	const server = createPreviewServer({ directory, publicRoot: 'https://example.test/packages/', port: 4186 });
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const request = (headers: Record<string, string> = {}, method = 'GET') => fetch(`${base}/package/test.pmtiles`, { method, headers });
	try {
		const first = await request({ Range: 'bytes=2-5', Origin: 'http://localhost:4186' });
		assert.equal(first.status, 206); assert.equal(await first.text(), '2345');
		assert.equal(first.headers.get('Content-Range'), 'bytes 2-5/10');
		assert.equal(first.headers.get('Content-Length'), '4');
		assert.equal(first.headers.get('Access-Control-Allow-Origin'), 'http://localhost:4186');
		const etag = first.headers.get('ETag')!;
		assert.equal(await (await request({ Range: 'bytes=-3' })).text(), '789');
		assert.equal(await (await request({ Range: 'bytes=8-' })).text(), '89');
		assert.equal(await (await request({ Range: 'bytes=0-999' })).text(), '0123456789');
		for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=999999999999999999-']) {
			const bad = await request({ Range: range }); assert.equal(bad.status, 416, range);
			assert.equal(bad.headers.get('Content-Range'), 'bytes */10'); await bad.arrayBuffer();
		}
		const head = await request({ Range: 'bytes=2-5' }, 'HEAD');
		assert.equal(head.status, 206); assert.equal(head.headers.get('Content-Length'), '4'); assert.equal(await head.text(), '');
		assert.equal((await request({ 'If-None-Match': etag })).status, 304);
		assert.equal((await request({ 'If-Match': '"stale"' })).status, 412);
		const stale = await request({ Range: 'bytes=0-1', 'If-Range': '"stale"' });
		assert.equal(stale.status, 200); assert.equal(await stale.text(), '0123456789');
		const matched = await request({ Range: 'bytes=0-1', 'If-Range': etag });
		assert.equal(matched.status, 206); assert.equal(await matched.text(), '01');
		const foreign = await request({ Origin: 'https://untrusted.test' });
		assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null); await foreign.arrayBuffer();
		assert.equal((await request({}, 'POST')).status, 405);
		assert.equal((await fetch(`${base}/package/escape.txt`)).status, 403);
		assert.equal((await fetch(`${base}/package/%2e%2e%2fprivate.txt`)).status, 400);
		assert.equal((await fetch(`${base}/package/missing`)).status, 404);
	} finally {
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		await rm(temporary, { recursive: true, force: true });
	}
});
