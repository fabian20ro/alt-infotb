/// <reference types="vite/client" />
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { PMTiles, FileSource, Protocol } from 'pmtiles';
import { parseOfflineMapManifest, MAX_MANIFEST_BYTES, type OfflineMapManifest } from '../../../src/lib/offline-maps/manifest.ts';
import { readerFor, PLACES } from '../src/profile.ts';
import './style.css';

type Theme = 'light' | 'dark';
interface Config { manifestUrl: string; publicRoot: string }
interface Scenario { place: string; zoom: number; theme: Theme; pixelRatio: number; features: number; symbols: number; idleMs: number }
const downloadButton = document.querySelector<HTMLButtonElement>('#download')!;
const themeSelect = document.querySelector<HTMLSelectElement>('#theme')!;
const statusElement = document.querySelector<HTMLElement>('#status')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const resultsElement = document.querySelector<HTMLElement>('#results')!;
const files = new Map<string, ArrayBuffer>();
const protocol = new Protocol();
maplibregl.setWorkerUrl(workerUrl);
maplibregl.addProtocol('pmtiles', protocol.tile);
maplibregl.addProtocol('localmap', async request => {
	const url = new URL(request.url);
	const file = url.pathname.slice(1);
	const bytes = files.get(file);
	if (url.hostname !== 'assets' || !bytes) throw new Error(`Missing packaged asset: ${file}`);
	return { data: request.type === 'json' ? JSON.parse(new TextDecoder().decode(bytes)) : bytes.slice(0) };
});

const state = {
	ready: false, errors: [] as string[], manifestSha256: '', downloadedBytes: 0, downloadedFiles: 0,
	manifest: null as OfflineMapManifest | null, map: null as maplibregl.Map | null,
	archive: null as PMTiles | null, theme: 'light' as Theme, scenarios: [] as Scenario[]
};
function showStatus(text: string) { statusElement.textContent = text; }
function describe() {
	resultsElement.textContent = JSON.stringify({ ready: state.ready, manifestSha256: state.manifestSha256,
		downloadedBytes: state.downloadedBytes, downloadedFiles: state.downloadedFiles,
		scenarios: state.scenarios, errors: state.errors }, null, 2);
}
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
async function fetchBytes(url: URL, maximum: number): Promise<ArrayBuffer> {
	const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(120_000) });
	if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url.pathname}`);
	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = response.body.getReader();
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (size > maximum) throw new Error(`Response exceeds declared size: ${url.pathname}`);
			chunks.push(next.value);
		}
	} catch (error) { await reader.cancel(); throw error; }
	finally { reader.releaseLock(); }
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	return output.buffer;
}
function localStyle(theme: Theme): maplibregl.StyleSpecification {
	const styleBytes = files.get(`${theme}.json`);
	if (!styleBytes || !state.archive) throw new Error('Package not loaded');
	const style = JSON.parse(new TextDecoder().decode(styleBytes)) as maplibregl.StyleSpecification;
	style.glyphs = 'localmap://assets/fonts/{fontstack}/{range}.pbf';
	style.sprite = `localmap://assets/sprites/${theme}`;
	style.sources = { basemap: { type: 'vector', url: `pmtiles://${state.archive.source.getKey()}`,
		attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · <a href="https://protomaps.com">Protomaps</a> · Natural Earth' } };
	return style;
}
async function settle(change: () => void): Promise<number> {
	const map = state.map;
	if (!map) throw new Error('Map not initialized');
	return new Promise((resolve, reject) => {
		const started = performance.now();
		const idle = () => { clearTimeout(timeout); resolve(Math.round(performance.now() - started)); };
		const timeout = setTimeout(() => { map.off('idle', idle); reject(new Error('Map idle timeout')); }, 30_000);
		map.once('idle', idle);
		try { change(); } catch (error) { clearTimeout(timeout); map.off('idle', idle); reject(error); }
	});
}
async function download() {
	downloadButton.disabled = true;
	themeSelect.disabled = true;
	state.ready = false;
	state.errors = [];
	state.scenarios = [];
	state.downloadedBytes = 0;
	state.downloadedFiles = 0;
	state.map?.remove(); state.map = null;
	if (state.archive) protocol.tiles.delete(state.archive.source.getKey());
	state.archive = null;
	files.clear();
	progress.hidden = false;
	try {
		const config = await (await fetch('/config.json', { cache: 'no-store' })).json() as Config;
		const manifestUrl = new URL(config.manifestUrl, location.href);
		const manifestBytes = await fetchBytes(manifestUrl, MAX_MANIFEST_BYTES);
		state.manifestSha256 = await digest(manifestBytes);
		const manifest = parseOfflineMapManifest(JSON.parse(new TextDecoder().decode(manifestBytes)), readerFor(config.publicRoot));
		if (manifest.totalBytes > 256 * 1024 * 1024) throw new Error('Memory-only test viewer limit: 256 MiB');
		state.manifest = manifest;
		const descriptors = [manifest.archive, ...manifest.assets];
		progress.max = manifest.totalBytes; progress.value = 0;
		let cursor = 0;
		let failed = false;
		const transfers = await Promise.allSettled(Array.from({ length: 8 }, async () => {
			while (!failed && cursor < descriptors.length) {
				const file = descriptors[cursor++];
				try {
					const bytes = await fetchBytes(new URL(file.path, manifestUrl), file.bytes);
					if (bytes.byteLength !== file.bytes || await digest(bytes) !== file.sha256) throw new Error(`SHA256/size mismatch: ${file.path}`);
					files.set(file.path, bytes);
					state.downloadedBytes += bytes.byteLength; state.downloadedFiles++;
					progress.value = state.downloadedBytes;
					showStatus(`Verificat ${(state.downloadedBytes / 1e6).toFixed(2)} / ${(manifest.totalBytes / 1e6).toFixed(2)} MB · ${state.downloadedFiles}/${descriptors.length} fișiere`);
				} catch (error) { failed = true; throw error; }
			}
		}));
		const failure = transfers.find(result => result.status === 'rejected');
		if (failure?.status === 'rejected') throw failure.reason;
		state.archive = new PMTiles(new FileSource(new File([files.get(manifest.archive.path)!], manifest.archive.path)));
		files.delete(manifest.archive.path);
		protocol.add(state.archive);
		state.theme = themeSelect.value as Theme;
		const map = new maplibregl.Map({ container: 'map', style: localStyle(state.theme),
			center: PLACES.Bucuresti, zoom: 12, minZoom: 0, maxZoom: 19,
			localIdeographFontFamily: 'sans-serif',
			attributionControl: { compact: true }, fadeDuration: 0 });
		state.map = map;
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
		map.on('error', event => { state.errors.push(event.error.message); describe(); });
		map.on('styleimagemissing', event => { state.errors.push(`Missing sprite: ${event.id}`); describe(); });
		await settle(() => map.triggerRepaint());
		if (state.errors.length) throw new Error(state.errors.join('; '));
		state.ready = true;
		showStatus('Pachet verificat. Harta folosește exclusiv fișierele din memorie. Poți opri conexiunea.');
		themeSelect.disabled = false;
	} catch (error) {
		state.errors.push(error instanceof Error ? error.message : String(error));
		showStatus(`Verificare nereușită: ${state.errors.at(-1)}`);
	} finally { progress.hidden = true; downloadButton.disabled = false; describe(); }
}
async function scenario(place: string, zoom: number, theme: Theme): Promise<Scenario> {
	const map = state.map;
	if (!state.ready || !map || !PLACES[place]) throw new Error('Unknown scenario or package not ready');
	if (theme !== state.theme) {
		await settle(() => map.setStyle(localStyle(theme)));
		state.theme = theme;
		themeSelect.value = theme;
	}
	const idleMs = await settle(() => { map.jumpTo({ center: PLACES[place], zoom }); map.triggerRepaint(); });
	const features = map.queryRenderedFeatures();
	const result = { place, zoom, theme, pixelRatio: devicePixelRatio, idleMs,
		features: features.length, symbols: features.filter(feature => feature.layer.type === 'symbol').length };
	if (!result.features || (zoom <= 15 && !result.symbols)) throw new Error(`Missing geometry/labels: ${place}/${zoom}/${theme}`);
	if (state.errors.length) throw new Error(state.errors.join('; '));
	state.scenarios.push(result); describe();
	return result;
}
downloadButton.onclick = () => { void download(); };
themeSelect.onchange = () => { void scenario('Bucuresti', state.map?.getZoom() ?? 12, themeSelect.value as Theme)
	.catch(error => { state.errors.push(String(error)); describe(); }); };
// Deliberate test seam. This viewer is never imported by the application.
Object.assign(window, { pmtilesHarness: { state, download, scenario } });
