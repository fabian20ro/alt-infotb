import { addProtocol, removeProtocol, type AddProtocolAction } from 'maplibre-gl';
import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { FileSource, PMTiles, TileType } from 'pmtiles';
import type { ReaderLease } from '../offline-maps/contracts.js';
import { PMTILES_PROFILE } from '../offline-maps/profile.js';

export interface OfflineBasemapSource {
	style(theme: 'light' | 'dark'): Promise<StyleSpecification>;
	rendered(): Promise<void>;
	failed(error: unknown): Promise<void>;
	/** The renderer must remove its map before releasing this source. */
	close(): Promise<void>;
}
export interface OfflineRenderCallbacks {
	/** True also when this exact generation is already confirmed and still usable. */
	confirmRendered(generationId: string): Promise<boolean>;
	rejectRendered(generationId: string): Promise<boolean>;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]!);
function requireThat(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Offline basemap: ${message}`);
}

/** Consume a validated installed generation. No storage implementation or network fallback here. */
export function createPmtilesSource(reader: ReaderLease, callbacks: OfflineRenderCallbacks): OfflineBasemapSource {
	const manifest = reader.generation.manifest;
	// Each map gets its own namespace, even when two maps read the same generation.
	const scheme = `offline-${crypto.randomUUID()}`;
	const origin = `${scheme}://map`;
	const shutdown = new AbortController();
	const pending = new Set<Promise<unknown>>();
	const assetPaths = new Map(manifest.assets.map(asset => [decodeURIComponent(asset.path), asset.path]));
	let closed = false;
	let closeResult: Promise<void> | undefined;
	let archiveResult: Promise<PMTiles> | undefined;
	let outcome: 'pending' | 'rendered' | 'failed' = 'pending';
	let firstFrameSeen = false;
	let confirmation: Promise<void> | undefined;
	let rejection: Promise<void> | undefined;
	function live() { if (closed) throw new DOMException('Offline map reader closed', 'AbortError'); }
	function usable(message: string) { live(); requireThat(outcome !== 'failed', message); }
	function tracked<T>(operation: () => Promise<T>): Promise<T> {
		live();
		const promise = operation(); pending.add(promise);
		void promise.then(() => pending.delete(promise), () => pending.delete(promise));
		return promise;
	}
	function archive() {
		archiveResult ??= tracked(async () => {
			const blob = await reader.archive(); live();
			const result = new PMTiles(new FileSource(new File([blob], `${scheme}.pmtiles`)));
			const header = await result.getHeader(); live();
			requireThat(header.specVersion === 3 && header.tileType === TileType.Mvt &&
				header.minZoom === manifest.nativeZoom.min && header.maxZoom === manifest.nativeZoom.max &&
				[header.minLon, header.minLat, header.maxLon, header.maxLat].every((n, i) => Math.abs(n - manifest.bounds[i]) < 0.000001),
				'archive header differs from installed manifest');
			return result;
		});
		return archiveResult;
	}
	const load: AddProtocolAction = (request, controller) => tracked(async () => {
		const signal = AbortSignal.any([shutdown.signal, controller.signal]);
		signal.throwIfAborted();
		const url = new URL(request.url);
		requireThat(url.protocol === `${scheme}:` && url.hostname === 'map' && !url.port && !url.username && !url.password && !url.search && !url.hash,
			'unknown resource URL');
		const tile = /^\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname);
		if (tile) {
			const [z, x, y] = tile.slice(1).map(Number);
			requireThat(Number.isSafeInteger(z) && z >= manifest.nativeZoom.min && z <= manifest.nativeZoom.max &&
				Number.isSafeInteger(x) && Number.isSafeInteger(y) && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z, 'invalid tile coordinate');
			const data = await (await archive()).getZxy(z, x, y, signal);
			live(); signal.throwIfAborted();
			return { data: data?.data ?? new ArrayBuffer(0) };
		}
		requireThat(url.pathname.startsWith('/assets/'), 'unknown resource');
		const path = assetPaths.get(decodeURIComponent(url.pathname.slice('/assets/'.length)));
		requireThat(path, 'undeclared asset');
		const bytes = await (await reader.asset(path)).arrayBuffer();
		live(); signal.throwIfAborted();
		return { data: request.type === 'json' ? JSON.parse(new TextDecoder().decode(bytes)) : bytes };
	});
	addProtocol(scheme, load);

	async function failed(_error: unknown) {
		if (closed) return;
		outcome = 'failed';
		// Once a first idle frame was proven, later GL/data loss does not roll back its package.
		if (!firstFrameSeen && !rejection) {
			rejection = callbacks.rejectRendered(reader.generation.id).then(() => {});
		}
		await rejection;
	}
	function close() {
		if (!closeResult) {
			closed = true; shutdown.abort(); removeProtocol(scheme);
			closeResult = (async () => {
				await Promise.allSettled([...pending, confirmation, rejection]);
				await reader.close();
			})();
		}
		return closeResult;
	}
	return {
		async style(theme) {
			live();
			try {
				requireThat(outcome !== 'failed', 'source failed; reopen the active map');
				requireThat(Object.entries(PMTILES_PROFILE).every(([key, value]) => manifest.compatibility[key as keyof typeof PMTILES_PROFILE] === value), 'unsupported package profile');
				const style = await tracked(async () => JSON.parse(await (await reader.asset(`${theme}.json`)).text())) as StyleSpecification;
				live();
				requireThat(Object.keys(style).every(key => ['version', 'glyphs', 'sprite', 'sources', 'layers'].includes(key)), 'unsupported style dependency');
				requireThat(validateStyleMin(style).length === 0, 'invalid package style');
				requireThat(style.glyphs === 'fonts/{fontstack}/{range}.pbf' && style.sprite === `sprites/${theme}`, 'external style resource');
				requireThat(Object.keys(style.sources).join(',') === 'basemap', 'unexpected style source');
				const source = style.sources.basemap;
				requireThat(source.type === 'vector' && source.url === `pmtiles://${manifest.archive.path}` &&
					Object.keys(source).every(key => ['type', 'url', 'attribution'].includes(key)), 'external source override');
				await archive(); live();
				const attribution = manifest.attributions.map(item => `<a href="${escapeHtml(item.url)}">${escapeHtml(item.text)}</a>`).join(' · ');
				return { ...style, glyphs: `${origin}/assets/fonts/{fontstack}/{range}.pbf`, sprite: `${origin}/assets/sprites/${theme}`,
					sources: { basemap: { type: 'vector', tiles: [`${origin}/tiles/{z}/{x}/{y}`],
						minzoom: manifest.nativeZoom.min, maxzoom: manifest.nativeZoom.max, bounds: [...manifest.bounds], attribution } } };
			} catch (error) {
				await failed(error);
				throw error;
			}
		},
		async rendered() {
			live();
			requireThat(outcome !== 'failed', 'first render failed; reopen the active map');
			if (outcome === 'pending') {
				// A later context loss is a new renderer failure, not a failed first frame.
				firstFrameSeen = true;
				outcome = 'rendered';
				confirmation = callbacks.confirmRendered(reader.generation.id).then(confirmed => {
					requireThat(confirmed, 'render confirmation rejected');
				}).catch(async error => {
					// Refused acknowledgement is not a confirmed first render.
					firstFrameSeen = false;
					await failed(error);
					throw error;
				});
			}
			await confirmation;
			usable('renderer failed after its first frame');
		},
		failed,
		close
	};
}
