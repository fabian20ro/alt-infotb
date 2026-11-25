import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copyPinned, downloadPinned, canonicalPath } from '../src/io.ts';

test('pinned downloads reject truncated/oversized/changed/redirected data and leave no candidates', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'pmtiles-io-'));
	const data = Buffer.from('pinned package');
	const expected = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
	const server = createServer((req, res) => {
		if (req.url === '/redirect') { res.writeHead(302, { location: '/valid' }).end(); return; }
		res.end(req.url === '/valid' ? data : req.url === '/short' ? data.subarray(0, 3) : req.url === '/long' ? Buffer.concat([data, data]) : Buffer.alloc(data.length));
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	try {
		for (const failure of ['short', 'long', 'changed', 'redirect']) {
			await assert.rejects(downloadPinned(`${base}/${failure}`, path.join(directory, failure), expected));
			assert.deepEqual(await readdir(directory), []);
		}
		const target = path.join(directory, 'valid');
		await downloadPinned(`${base}/valid`, target, expected);
		assert.deepEqual(await readFile(target), data);
		await downloadPinned(`${base}/unavailable`, target, expected); // verified cache hit
		await writeFile(target, Buffer.alloc(data.length));
		await assert.rejects(downloadPinned(`${base}/valid`, target, expected), /Pinned file mismatch/);
	} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});

test('font URL encoding preserves spaces and retina sprite identity', () => {
	assert.equal(canonicalPath('fonts/Noto Sans Regular/0-255.pbf'), 'fonts/Noto%20Sans%20Regular/0-255.pbf');
	assert.equal(canonicalPath('sprites/light@2x.png'), 'sprites/light@2x.png');
});

test('ZIP extraction expands safe aliases but rejects escapes and cycles', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'pmtiles-zip-'));
	const extractor = fileURLToPath(new URL('../src/extract-assets.py', import.meta.url));
	try {
		for (const mode of ['safe', 'escape', 'cycle', 'traversal', 'dot-alias', 'separator-alias']) {
			const zip = path.join(directory, `${mode}.zip`);
			execFileSync('python3', ['-c', `import sys,zipfile,stat
with zipfile.ZipFile(sys.argv[1],'w') as z:
 p='basemaps-assets-pin/fonts/Noto Sans Regular/'
 z.writestr(p+'0-255.pbf',b'valid')
 mode=sys.argv[2]
 if mode=='traversal': z.writestr(p+'../../../../evil.pbf',b'bad')
 elif mode=='dot-alias': z.writestr(p+'./0-255.pbf',b'overwritten')
 elif mode=='separator-alias': z.writestr(p+'/0-255.pbf',b'overwritten')
 else:
  item=zipfile.ZipInfo(p+'256-511.pbf'); item.create_system=3; item.external_attr=(stat.S_IFLNK|0o777)<<16
  z.writestr(item,{'safe':'0-255.pbf','escape':'../../../../evil','cycle':'256-511.pbf'}[mode])`, zip, mode]);
			const out = path.join(directory, mode);
			if (mode === 'safe') {
				execFileSync('python3', [extractor, zip, out, 'pin']);
				assert.equal(await readFile(path.join(out, 'fonts/Noto Sans Regular/256-511.pbf'), 'utf8'), 'valid');
			} else assert.throws(() => execFileSync('python3', [extractor, zip, out, 'pin'], { stdio: 'pipe' }));
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});


test('pinned local copies expose only validated cache entries and clean up failed candidates', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'pmtiles-copy-'));
	const source = path.join(directory, 'source'); const destination = path.join(directory, 'cached');
	const bytes = Buffer.from('validated extraction');
	const expected = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
	try {
		await writeFile(source, Buffer.alloc(bytes.length));
		await assert.rejects(copyPinned(source, destination, expected), /Pinned file mismatch/);
		assert.deepEqual(await readdir(directory), ['source']);
		await writeFile(source, bytes);
		await Promise.all([copyPinned(source, destination, expected), copyPinned(source, destination, expected)]);
		assert.deepEqual(await readFile(destination), bytes);
		assert.deepEqual((await readdir(directory)).sort(), ['cached', 'source']);
		await copyPinned(path.join(directory, 'missing-source'), destination, expected);
		await writeFile(destination, Buffer.alloc(bytes.length));
		await assert.rejects(copyPinned(source, destination, expected), /Pinned file mismatch/);
		assert.deepEqual(await readFile(destination), Buffer.alloc(bytes.length), 'conflicting cache bytes are never overwritten');
	} finally { await rm(directory, { recursive: true, force: true }); }
});
