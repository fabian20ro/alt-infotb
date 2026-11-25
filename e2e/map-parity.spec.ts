import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { syntheticMapTile } from './fixtures/map-tile.ts';
import catalog from '../src/lib/stations/stations.json' with {type:'json'};
const tile=syntheticMapTile();
const browserErrors=new WeakMap<Page,string[]>();
const tileRequests=new WeakMap<Page,string[]>();
const station=(page:Page,name:string)=>page.getByRole('button',{name,exact:true});
async function open(page:Page,engine:string,extra='') {
	await page.goto(`/e2e/fixtures/map-parity.html?engine=${engine}${extra}`);
	await expect.poll(()=>page.evaluate(()=>(window as any).parity?.stats.ready)).toBe(true);
	await expect(page.locator('.station-marker').first()).toBeVisible();
}
async function distance(page:Page) {
	const user=await page.locator('.user-location-marker').boundingBox(),map=await page.locator('.map-container').boundingBox();
	return user&&map?Math.hypot(user.x+user.width/2-map.x-map.width/2,user.y+user.height/2-map.y-map.height/2):Infinity;
}
async function pan(page:Page,engine:string) {
	await page.locator(engine==='maplibre'?'.maplibregl-canvas':'.map-container').press('ArrowRight');
	await expect.poll(()=>distance(page)).toBeGreaterThan(35);
	if(engine==='maplibre')await expect.poll(()=>page.evaluate(()=>(window as any).parity.inspect().moving)).toBe(false);
	else await expect(page.locator('.leaflet-pan-anim')).toHaveCount(0);
}
test.beforeEach(async({page,baseURL})=>{
	const requests:string[]=[];tileRequests.set(page,requests);page.on('request',request=>{if(request.url().startsWith('https://basemaps.cartocdn.com/'))requests.push(request.url());});
	const errors:string[]=[];browserErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));
	const origin=new URL(baseURL!).origin;
	await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
	await page.route('**/e2e/fixtures/map-parity.html*',async route=>route.fulfill({contentType:'text/html',body:await readFile(new URL('./fixtures/map-parity.html',import.meta.url),'utf8')}));
	await page.route('**/*.png**',route=>route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:tile}));
});
test.afterEach(async({page})=>{expect(browserErrors.get(page)).toEqual([]);});
for(const engine of ['leaflet','maplibre'])test.describe(engine,()=>{
	test('accessible station selection survives theme and catalog refresh; actual touch targets remain visible',async({page,isMobile})=>{
		await open(page,engine);
		if(engine==='maplibre'){await expect(page.getByTestId('tile-status')).not.toBeVisible();const retina=await page.evaluate(()=>devicePixelRatio>1);expect(tileRequests.get(page)!.length).toBeGreaterThan(0);expect(tileRequests.get(page)!.every(url=>url.includes('@2x')===retina)).toBe(true);}
		for(const name of ['Stația A','Stația B','Stația A']) {
			const target=station(page,name);await expect(target).toBeVisible();
			if(isMobile){const box=(await target.boundingBox())!,point={x:box.x+box.width/2,y:box.y+box.height/2};
				expect(await target.evaluate((element,p)=>element.contains(document.elementFromPoint(p.x,p.y)),point)).toBe(true);await page.touchscreen.tap(point.x,point.y);}
			else {await target.focus();await target.press(name==='Stația B'?'Space':'Enter');}
		}
		await expect(page.getByLabel('Selected station IDs')).toHaveText('1,2,1');
		await page.getByRole('button',{name:'Theme',exact:true}).click();await page.getByRole('button',{name:'Poll snapshot'}).click();
		await station(page,'Stația B').focus();await station(page,'Stația B').press('Enter');
		await expect(page.getByLabel('Selected station IDs')).toHaveText('1,2,1,2');
	});
	test('route membership in both directions remains visible above density cap in both themes',async({page})=>{
		await open(page,engine);await page.getByRole('button',{name:'Line 66 synthetic'}).click();
		for(let theme=0;theme<2;theme++) {
			for(const name of ['Stația A','Stația B','Sens întors'])await expect(station(page,name)).toHaveCSS('opacity','0.72');
			await expect(station(page,'Altă linie')).toHaveCSS('opacity','0.32');
			await page.getByRole('button',{name:'Theme',exact:true}).click();
		}
		await page.getByRole('button',{name:'Dense stations'}).click();
		await expect(page.locator('.station-marker-on-route')).toHaveCount(3);await expect(station(page,'Altă linie')).toHaveCount(0);
		await station(page,'Stația A').press('Enter');await expect(station(page,'Stația A')).toHaveCSS('opacity','1');
	});
	test('pending GPS recenters once; polling and a later fix preserve manual camera; errors localize',async({page})=>{
		await open(page,engine,'&no-position');await page.getByRole('button',{name:'Recentrare',exact:true}).click();
		await expect(page.locator('.location-status')).toContainText('Se așteaptă locația');
		await page.getByRole('button',{name:'Deliver GPS'}).click();
		await expect.poll(()=>distance(page)).toBeLessThan(5);await pan(page,engine);
		const calls=await page.evaluate(()=>(window as any).parity.stats.camera);
		await page.getByRole('button',{name:'Poll snapshot'}).click();await page.getByRole('button',{name:'Move GPS'}).click();
		await expect.poll(()=>distance(page)).toBeGreaterThan(20);expect(await page.evaluate(()=>(window as any).parity.stats.camera)).toBe(calls);
		await page.getByRole('button',{name:'Recentrare',exact:true}).click();await expect.poll(()=>distance(page)).toBeLessThan(5);
		await page.getByRole('button',{name:'Clear GPS'}).click();await page.getByRole('button',{name:'Recentrare',exact:true}).click();
		await page.getByRole('button',{name:'Fail GPS'}).click();await expect(page.locator('.location-status')).toContainText('Locația nu este disponibilă');
		await page.getByRole('button',{name:'Language'}).click();await expect(page.locator('.location-status')).toContainText('Location is currently unavailable');
	});
	test('captured 66 draws both routes and synthetic vehicles; overview does not repeat on polling',async({page})=>{
		await open(page,engine);await page.getByRole('button',{name:'Line 66 captured'}).click();
		await expect(page.locator('.station-marker-on-route')).toHaveCount(36);
		await expect(page.locator('.vehicle-marker.primary')).toHaveCount(1);await expect(page.locator('.vehicle-marker.opposite')).toHaveCount(1);
		if(engine==='maplibre')await expect.poll(()=>page.evaluate(()=>(window as any).parity.inspect().routeFeatures)).toBeGreaterThan(1);
		else {await expect(page.locator('.selected-route-line')).toHaveCount(1);await expect(page.locator('.opposite-route-line')).toHaveCount(1);}
		const priorFits=await page.evaluate(()=>(window as any).parity.stats.fits);
		await page.getByRole('button',{name:'Overview',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).parity.stats.fits)).toBe(priorFits+1);
		const fits=await page.evaluate(()=>(window as any).parity.stats.fits);
		await page.getByRole('button',{name:'Poll snapshot'}).click();await page.getByRole('button',{name:'Theme',exact:true}).click();
		expect(await page.evaluate(()=>(window as any).parity.stats.fits)).toBe(fits);await expect(page.locator('.vehicle-marker')).toHaveCount(2);
	});
	test('full N109 catalog keeps every served station and all three Isovolta platforms',async({page})=>{
		await open(page,engine);await page.getByRole('button',{name:'N109 Isovolta'}).click();
		const expected=catalog.stations.filter(s=>'lineIds'in s&&(s.lineIds as number[]).includes(199)).length;
		await expect(page.locator('.station-marker-on-route')).toHaveCount(expected);
		await expect(station(page,'Isovolta')).toHaveCount(3);
	});
	test('destroy removes canvas/markers and remount selects stations once',async({page})=>{
		await open(page,engine);await page.getByRole('button',{name:'Toggle map'}).click();
		await expect(page.locator('.station-marker,.maplibregl-canvas,.leaflet-container')).toHaveCount(0);
		await page.getByRole('button',{name:'Toggle map'}).click();await expect(station(page,'Stația A')).toBeVisible();
		await station(page,'Stația A').click();await expect(page.getByLabel('Selected station IDs')).toHaveText('1');
		expect(await page.evaluate(()=>(window as any).parity.stats.destroys)).toBe(1);
	});
});

test('static preview route geometry matches the original captured protobuf bytes',async({page})=>{
	await open(page,'leaflet');
	for(const [filename,stopId,key]of [['line66-forward.pb',3684,'primary'],['line66-return.pb',3675,'opposite']]as const){
		const bytes=[...await readFile(new URL(`../src/lib/map/fixtures/${filename}`,import.meta.url))];
		const matches=await page.evaluate(async({bytes,stopId,key})=>{const {decodeStopResponse}=await import('/src/lib/api/arrivals.ts');const a=decodeStopResponse(new Uint8Array(bytes),stopId).arrivals.find((a:any)=>a.lineId===72);return JSON.stringify(a.path)===JSON.stringify((window as any).parity.captured[key].path);},{bytes,stopId,key});
		expect(matches).toBe(true);
	}
});

for(const scenario of ['factory-fail','factory-slow'])test(`MapLibre ${scenario} releases the component cleanly`,async({page})=>{
	await page.goto(`/e2e/fixtures/map-parity.html?engine=maplibre&${scenario}`);
	if(scenario==='factory-fail'){await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);}
	else {await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);await page.getByRole('button',{name:'Toggle map'}).click();await page.evaluate(()=>(window as any).parity.releaseFactory());await expect.poll(()=>page.evaluate(()=>(window as any).parity.stats.destroys)).toBe(1);await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);}
});
test('MapLibre uses the latest scene after rapid style changes',async({page})=>{
	await open(page,'maplibre');await page.evaluate(()=>(window as any).parity.burst());
	await expect(page.locator('.vehicle-marker')).toHaveCount(1);await expect(page.locator('.vehicle-marker')).toHaveText('FINAL');
	await expect.poll(()=>page.evaluate(()=>(window as any).parity.inspect().styleLoaded)).toBe(true);
	await expect(page.locator('.vehicle-marker')).toHaveText('FINAL');
	await page.evaluate(()=>(window as any).parity.clearRenderedRoute());await expect(page.locator('.vehicle-marker')).toHaveCount(0);
	await expect.poll(()=>page.evaluate(()=>(window as any).parity.inspect().routeFeatures)).toBe(0);
});

test('MapLibre rejects CARTO placeholders, bounds retries and recovers through satellite and street styles',async({page})=>{
	await open(page,'maplibre');await expect(page.getByTestId('tile-status')).not.toBeVisible();
	const placeholder=await readFile(new URL('./fixtures/carto-api-key-required.png',import.meta.url));let requests=0;
	await page.route('https://basemaps.cartocdn.com/**',route=>{requests++;return route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:placeholder});});
	await page.getByRole('button',{name:'Theme',exact:true}).click();await expect(page.getByTestId('tile-status')).toContainText('nu este disponibil');
	await expect(station(page,'Stația A')).toBeVisible();await page.getByRole('button',{name:'Reîncearcă harta',exact:true}).click();
	await expect(page.getByRole('button',{name:'Așteaptă înainte de reîncercare'})).toBeDisabled();expect(requests).toBeLessThanOrEqual(2);
	await page.route('https://server.arcgisonline.com/**',route=>route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:tile}));
	await page.getByRole('button',{name:'Vezi satelit'}).click();await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Esri');
	await page.unroute('https://basemaps.cartocdn.com/**');
	await page.getByRole('button',{name:'Înapoi la harta stradală'}).click();await expect(page.getByTestId('tile-status')).not.toBeVisible();
	await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('CARTO');await expect(page.locator('.maplibregl-ctrl-attrib')).not.toContainText('Esri');
});
test('MapLibre reports WebGL loss and keeps a usable station scene until remount',async({page})=>{
	await open(page,'maplibre');await expect(page.getByTestId('tile-status')).not.toBeVisible();
	const supported=await page.locator('.maplibregl-canvas').evaluate((canvas:HTMLCanvasElement)=>{const gl=canvas.getContext('webgl2');const extension=gl?.getExtension('WEBGL_lose_context');if(!extension)return false;extension.loseContext();return true;});
	expect(supported).toBe(true);await expect(page.getByTestId('tile-status')).toContainText('nu este disponibil');await expect(station(page,'Stația A')).toBeVisible();
	await page.getByRole('button',{name:'Toggle map'}).click();await page.getByRole('button',{name:'Toggle map'}).click();
	await expect(page.getByTestId('tile-status')).not.toBeVisible();await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
});

test('MapLibre WebGL initialization failure leaves the component alert without orphan nodes',async({page})=>{
	await page.addInitScript(()=>{
		const original=HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext=function(type:string,...args:any[]){
			if(type==='webgl2'||type==='webgl'||type==='experimental-webgl')return null;
			return (original as any).call(this,type,...args);
		} as typeof original;
	});
	await page.goto('/e2e/fixtures/map-parity.html?engine=maplibre');
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.locator('.maplibregl-canvas,.maplibregl-control-container,.maplibre-preview-engine')).toHaveCount(0);
	await expect(page.locator('.map-container')).toHaveCount(1);
});
