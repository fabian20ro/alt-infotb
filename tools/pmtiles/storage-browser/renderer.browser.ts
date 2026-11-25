import { test, expect, type Page } from '@playwright/test';
import catalog from '../../../src/lib/stations/stations.json' with {type:'json'};
async function ready(page:Page){await page.goto('/');await page.waitForFunction(()=>(window as any).storageHarness?.state.ready,null,{timeout:60_000});}
async function mapReady(page:Page){await page.waitForFunction(()=>{const h=(window as any).storageHarness;if(h.state.errors.length)throw new Error(h.state.errors.join(';'));return h.state.mapReady;},null,{timeout:60_000});}
async function snapshot(page:Page){return page.evaluate(()=>(window as any).storageHarness.manager.snapshot());}

test('actual renderer replays 66 and N109 offline, switches theme, handles WebGL loss and keeps package',async({page,context})=>{
	await ready(page);await page.evaluate(()=>(window as any).storageHarness.install());await mapReady(page);
	const active=(await snapshot(page)).active.id;
	await page.evaluate(()=>(window as any).storageHarness.selectLine('66'));
	await expect(page.locator('.station-marker-on-route')).toHaveCount(36);
	const online=await page.evaluate(()=>(window as any).storageHarness.sample());expect(online.routeFeatures).toBeGreaterThan(1);
	await context.setOffline(true);
	await page.evaluate(()=>(window as any).storageHarness.selectLine('N109'));
	await expect(page.getByRole('button',{name:'Isovolta',exact:true})).toHaveCount(3);
	await page.evaluate(()=>(window as any).storageHarness.selectLine('446'));
	const regional=catalog.stations.filter(s=>'lineIds'in s&&(s.lineIds as number[]).includes(859));
	await expect(page.locator('.station-marker-on-route')).toHaveCount(regional.length);
	for(const stop of regional.filter(s=>s.lat>44.74))await expect(page.locator(`[data-station-id="${stop.id}"]`)).toBeVisible();
	await page.selectOption('#theme','dark');await mapReady(page);
	expect((await page.evaluate(()=>(window as any).storageHarness.sample())).symbols).toBeGreaterThan(0);
	await page.evaluate(()=>(window as any).storageHarness.selectLine('66'));await mapReady(page);
	await expect(page.locator('.station-marker-on-route')).toHaveCount(36);
	const supported=await page.locator('canvas').evaluate((canvas:HTMLCanvasElement)=>{const ext=canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');ext?.loseContext();return !!ext;});
	expect(supported).toBe(true);await expect.poll(()=>page.evaluate(()=>(window as any).storageHarness.state.lastErrorKind)).toBe('context-lost');
	expect(await snapshot(page)).toMatchObject({active:{id:active},availability:'ready',pendingRender:false});
	await page.evaluate(async()=>{const h=(window as any).storageHarness;h.state.errors=[];await h.repairView();});await mapReady(page);
	expect((await snapshot(page)).active.id).toBe(active);await expect(page.locator('canvas')).toHaveCount(1);
});

test('missing stored style reports damage without deleting the installed generation',async({page})=>{
	await ready(page);await page.evaluate(()=>(window as any).storageHarness.install());
	const active=(await snapshot(page)).active.id;
	await page.evaluate(async()=>{const h=(window as any).storageHarness,s=await h.manager.snapshot();const name=(await caches.keys()).find(n=>n.endsWith(`:generation:${s.active.id}`))!;const c=await caches.open(name);const key=(await c.keys()).find(r=>r.url.endsWith('/dark.json'))!;await c.delete(key);await h.switchBasemap('dark');});
	await expect.poll(()=>page.evaluate(()=>(window as any).storageHarness.state.lastErrorKind)).toBe('offline-data');
	expect(await snapshot(page)).toMatchObject({active:{id:active},availability:'damaged'});
});
