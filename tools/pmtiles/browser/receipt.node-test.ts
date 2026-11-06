import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import ReceiptReporter from './receipt-reporter.ts';
import { PLACES } from '../src/profile.ts';

test('browser receipts require every offline scenario against the same manifest; failures remove stale receipt', async () => {
	const temporary = await mkdtemp(path.join(os.tmpdir(), 'pmtiles-receipt-'));
	const receipt = path.join(temporary, 'receipt.json');
	const saved = { ...process.env };
	process.env.PMTILES_BROWSER_RECEIPT = receipt;
	process.env.PMTILES_PACKAGE_DIR = temporary;
	process.env.PMTILES_TOOL_REVISION = 'a'.repeat(40);
	const manifest = Buffer.from('{"test":"manifest bytes"}');
	const hash = createHash('sha256').update(manifest).digest('hex');
	const fullResult = { status: 'passed' } as FullResult;
	const report = (reporter: ReceiptReporter, ratio: number, digest = hash, offline = true) => {
		const scenarios = Object.keys(PLACES).flatMap(place => ['light', 'dark'].flatMap(theme => [10, 15, 18].map(zoom => ({ place, theme, zoom, pixelRatio: ratio }))));
		reporter.onTestEnd({} as TestCase, { status: 'passed', attachments: [{ name: 'pmtiles-scenarios', contentType: 'application/json',
			body: Buffer.from(JSON.stringify({ manifestSha256: digest, offline, scenarios })) }] } as TestResult);
	};
	try {
		await writeFile(path.join(temporary, 'manifest.json'), manifest);
		const complete = new ReceiptReporter(); complete.onBegin(); report(complete, 1); report(complete, 2); complete.onEnd(fullResult);
		assert.deepEqual(JSON.parse(await readFile(receipt, 'utf8')), { schemaVersion: 1, manifestSha256: hash,
			toolRevision: 'a'.repeat(40), passed: true, scenarios: 84, themes: ['light', 'dark'], pixelRatios: [1, 2], offline: true });
		const failed = new ReceiptReporter(); failed.onBegin(); failed.onEnd({ status: 'failed' } as FullResult);
		await assert.rejects(access(receipt));
		for (const variant of ['missing-project', 'duplicate-project', 'wrong-manifest', 'online']) {
			const rejected = new ReceiptReporter(); rejected.onBegin(); report(rejected, 1);
			if (variant !== 'missing-project') report(rejected, variant === 'duplicate-project' ? 1 : 2,
				variant === 'wrong-manifest' ? 'b'.repeat(64) : hash, variant !== 'online');
			assert.throws(() => rejected.onEnd(fullResult), /incomplete\/mismatched/, variant);
			await assert.rejects(access(receipt));
		}
	} finally {
		for (const key of ['PMTILES_BROWSER_RECEIPT', 'PMTILES_PACKAGE_DIR', 'PMTILES_TOOL_REVISION']) {
			if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
		}
		await rm(temporary, { recursive: true, force: true });
	}
});
