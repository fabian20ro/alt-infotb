import { FileSource, PMTiles, TileType } from 'pmtiles';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { sha256 } from '@noble/hashes/sha2.js';
import type { GenerationStore } from '../../../src/lib/offline-maps/contracts.ts';
import { createCandidateValidator } from '../../../src/lib/offline-maps/candidate-validation.ts';

/** Native Node and browser tooling resolve dependencies from the isolated tooling lockfile. */
export function createBrowserCandidateValidator(files: GenerationStore) {
	return createCandidateValidator(files, { FileSource, PMTiles, TileType, validateStyleMin, sha256 });
}
