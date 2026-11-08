import type { MapProfile } from './manifest.ts';

/** Renderer and generator must agree before a local package is accepted. */
export const PMTILES_PROFILE: MapProfile = {
	renderer: 'maplibre', tileSchema: 'protomaps-4.15.2', style: 'protomaps-5.7.2-ro-v1'
};
