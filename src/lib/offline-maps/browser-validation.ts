import { FileSource, PMTiles, TileType } from 'pmtiles';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { sha256 } from '@noble/hashes/sha2.js';
import type { GenerationStore } from './contracts.ts';
import { createCandidateValidator } from './candidate-validation.ts';

/** The application resolves runtime dependencies from its own pinned dependency graph. */
export function createBrowserCandidateValidator(files: GenerationStore) {
	return createCandidateValidator(files, { FileSource, PMTiles, TileType, validateStyleMin, sha256 });
}
