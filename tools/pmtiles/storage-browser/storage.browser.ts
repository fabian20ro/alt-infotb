import { test, expect, chromium, type Page } from '@playwright/test';
// This deliberately isolated harness exposes its ports to exercise real browser storage failures.
async function ready(page: Page) {
	await page.goto('/');
	await page.waitForFunction(() => (window as any).storageHarness?.state.ready, null, { timeout: 60_000 });
}
async function snapshot(page: Page) { return page.evaluate(() => (window as any).storageHarness.manager.snapshot()); }

test('persistent install, offline reload, update leases, rollback and cross-tab deletion', async ({ page, context }) => {
	await ready(page);
	await page.evaluate(async () => {
		await new Promise<void>((resolve, reject) => { const request = indexedDB.open('unrelated-user-data', 1); request.onupgradeneeded = () => request.result.createObjectStore('keep'); request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error); });
		const unrelated = await caches.open('unrelated-user-data'); await unrelated.put('/sentinel', new Response('keep'));
		const root = await navigator.storage.getDirectory(); const file = await root.getFileHandle('unrelated-sentinel', { create: true });
		const writer = await file.createWritable(); await writer.write('keep'); await writer.close();
	});
	await page.getByRole('button', { name: 'Instalează pachetul' }).click();
	await page.waitForFunction(() => { const s = (window as any).storageHarness.state; if (s.errors.length) throw new Error(s.errors.join('; ')); return s.mapReady; }, null, { timeout: 180_000 });
	const installed = await snapshot(page);
	expect(installed.availability).toBe('ready'); expect(installed.pendingRender).toBe(false);
	await page.getByRole('button', { name: 'Cere stocare persistentă' }).click();
	expect(['granted', 'not-granted', 'unavailable']).toContain((await snapshot(page)).persistence);
	expect(await page.evaluate(() => (window as any).storageHarness.sample())).toMatchObject({ features: expect.any(Number), symbols: expect.any(Number) });
	await context.setOffline(true);
	await ready(page);
	expect((await snapshot(page)).active.id).toBe(installed.active.id);
	expect(await page.evaluate(() => (window as any).storageHarness.state.mapReady)).toBe(true);
	const sample = await page.evaluate(() => (window as any).storageHarness.sample());
	expect(sample.features).toBeGreaterThan(0); expect(sample.symbols).toBeGreaterThan(0);
	await context.setOffline(false);

	await page.evaluate(() => (window as any).storageHarness.holdReader());
	await page.evaluate(() => (window as any).storageHarness.install(1));
	const updated = await snapshot(page);
	expect(updated.active.manifest.version).not.toBe(installed.active.manifest.version);
	expect(updated.pendingDeletionCount).toBe(1);
	await page.evaluate(() => (window as any).storageHarness.releaseReaders());
	expect((await snapshot(page)).pendingDeletionCount).toBe(0);
	// A same-version repair is a separate immutable generation; rejecting first render restores its predecessor.
	await page.evaluate(async () => { const h = (window as any).storageHarness; await h.manager.install(h.offers[1], undefined, { repair: true }); });
	const candidate = await snapshot(page);
	expect(candidate.pendingRender).toBe(true); expect(candidate.active.id).not.toBe(updated.active.id);
	await page.evaluate(async () => { const h = (window as any).storageHarness; await h.manager.rejectRendered((await h.manager.snapshot()).active.id); });
	expect((await snapshot(page)).active.id).toBe(updated.active.id);

	const second = await context.newPage(); await ready(second);
	expect((await snapshot(second)).active.id).toBe(updated.active.id);
	await second.evaluate(() => (window as any).storageHarness.remove());
	expect((await snapshot(second)).availability).toBe('absent');
	expect((await snapshot(second)).pendingDeletionCount).toBe(1);
	// Existing tab continues reading until its shared lease closes; delete never invalidates its file.
	expect((await page.evaluate(() => (window as any).storageHarness.sample())).features).toBeGreaterThan(0);
	await page.evaluate(() => (window as any).storageHarness.closeView());
	await second.evaluate(() => (window as any).storageHarness.manager.cleanup());
	expect((await snapshot(second)).pendingDeletionCount).toBe(0);
	expect(await page.evaluate(async () => (await indexedDB.databases()).some(database => database.name === 'unrelated-user-data'))).toBe(true);
	expect(await page.evaluate(async () => (await caches.open('unrelated-user-data')).match('/sentinel').then(r => r?.text()))).toBe('keep');
	expect(await page.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('unrelated-sentinel')).getFile()).text())).toBe('keep');
});

test('cross-tab cancellation recovers incomplete candidate', async ({ page, context }) => {
	await ready(page);
	const second = await context.newPage(); await ready(second);
	let archiveReached!: () => void;
	const reached = new Promise<void>(resolve => { archiveReached = resolve; });
	let unblock!: () => void;
	const blocked = new Promise<void>(resolve => { unblock = resolve; });
	await page.route('**/package/**/*.pmtiles', async route => { archiveReached(); await blocked; await route.abort().catch(() => {}); });
	await page.evaluate(() => { const h = (window as any).storageHarness; h.installResult = h.manager.install(h.offers[0]).then(() => 'success', (e: Error) => e.name); });
	await reached;
	await second.evaluate(() => (window as any).storageHarness.manager.cancel());
	unblock();
	expect(await page.evaluate(() => (window as any).storageHarness.installResult)).not.toBe('success');
	expect((await snapshot(second)).availability).toBe('absent');
	await page.unroute('**/package/**/*.pmtiles');

});

test('browser adapter rejects invalid transactions and aborts interrupted OPFS writes', async ({ page }) => {
	await ready(page);
	const result = await page.evaluate(async () => {
		const h = (window as any).storageHarness;
		const { metadata, files, locks } = h.storage;
		const before = await metadata.read();
		let invalidRejected = false;
		try { await metadata.change((s: any) => ({ ...s, schemaVersion: 999 })); } catch { invalidRejected = true; }
		const after = await metadata.read();
		// IDB serializes concurrent read-modify-write transactions; both changes must survive.
		await metadata.change((s: any) => ({ ...s, operation: { id: crypto.randomUUID(), phase: 'downloading', cancelled: false } }));
		await Promise.all([
			metadata.change((s: any) => ({ ...s, operation: { ...s.operation, cancelled: true } })),
			metadata.change((s: any) => ({ ...s, operation: { ...s.operation, id: 'transaction-updated' } }))
		]);
		const concurrent = await metadata.read();
		await metadata.change(() => before);
		const shared = await locks.acquire('adapter-test-reader', 'shared');
		const blocked = await locks.acquire('adapter-test-reader', 'exclusive', { ifAvailable: true });
		await shared.release();
		const exclusive = await locks.acquire('adapter-test-reader', 'exclusive', { ifAvailable: true });
		await exclusive.release();
		const { manifest } = await h.manager.checkUpdate(h.offers[0]);
		const generation = { id: crypto.randomUUID(), manifest, manifestSha256: h.offers[0].manifestSha256 };
		await files.create(generation);
		let interrupted = false;
		async function* stream() { yield new Uint8Array([80, 77, 84, 105, 108, 101, 115]); throw new Error('simulated network interruption'); }
		try { await files.write(generation, manifest.archive, stream(), new AbortController().signal); } catch { interrupted = true; }
		const intact = await files.inspect(generation);
		await files.remove(generation); await files.remove(generation);
		return { invalidRejected, unchanged: JSON.stringify(before) === JSON.stringify(after),
			cancelled: concurrent.operation.cancelled, id: concurrent.operation.id, blocked: blocked === null, exclusive: !!exclusive, interrupted, intact };
	});
	expect(result).toEqual({ invalidRejected: true, unchanged: true, cancelled: true, id: 'transaction-updated', blocked: true, exclusive: true, interrupted: true, intact: false });
});


test('browser process crash recovers candidate and restarts the installed map offline', async ({}, testInfo) => {
	const profile = testInfo.outputPath('persistent-profile');
	const launch = () => chromium.launchPersistentContext(profile, { headless: true,
		args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
		baseURL: 'http://localhost:4187', serviceWorkers: 'allow', viewport: { width: 411, height: 784 } });
	let context = await launch();
	let activeId = '';
	try {
		const page = await context.newPage(); await ready(page);
		await page.evaluate(() => (window as any).storageHarness.install());
		activeId = (await snapshot(page)).active.id;
		let reached!: () => void;
		const suspended = new Promise<void>(resolve => { reached = resolve; });
		await page.route('**/package/**/*.pmtiles', async () => { reached(); });
		await page.evaluate(() => { const h = (window as any).storageHarness; void h.manager.install(h.offers[1]).catch(() => {}); });
		await suspended;
		const cdp = await context.browser()!.newBrowserCDPSession();
		const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
		const browserProcess = processInfo.find(item => item.type === 'browser');
		if (!browserProcess) throw new Error('Could not identify test browser process');
		const disconnected = new Promise<void>(resolve => context.browser()!.once('disconnected', () => resolve()));
		process.kill(browserProcess.id, 'SIGKILL');
		await disconnected;
	} finally { await context.close().catch(() => {}); }
	context = await launch();
	try {
		await context.setOffline(true);
		const page = await context.newPage(); await ready(page);
		expect((await snapshot(page)).active.id).toBe(activeId);
		expect(await page.evaluate(() => (window as any).storageHarness.state.mapReady)).toBe(true);
		const sample = await page.evaluate(() => (window as any).storageHarness.sample());
		expect(sample.features).toBeGreaterThan(0); expect(sample.symbols).toBeGreaterThan(0);
	} finally { await context.close(); }
});
