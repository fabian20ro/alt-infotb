import type { MapProfile } from './manifest.ts';

/** Renderer and generator must agree before a local package is accepted. */
export const PMTILES_PROFILE: MapProfile = {
	renderer: 'maplibre', tileSchema: 'protomaps-4.15.2', style: 'protomaps-5.7.2-ro-v1'
};

export const FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic', 'Noto Sans Devanagari Regular v1'] as const;
export const PLACES: Record<string, [number, number]> = {
	Bucuresti: [26.1025, 44.4268], Otopeni: [26.069, 44.551], Snagov: [26.175, 44.705],
	Buftea: [25.949, 44.565], Cernica: [26.275, 44.414], Vidra: [26.171, 44.26], Peris: [26.014, 44.684]
};
