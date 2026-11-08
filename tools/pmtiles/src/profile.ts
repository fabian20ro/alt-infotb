import type { ManifestReader } from '../../../src/lib/offline-maps/manifest.ts';
import { PMTILES_PROFILE } from '../../../src/lib/offline-maps/profile.ts';

export const PROFILE = PMTILES_PROFILE;
export { FONT_STACKS, PLACES } from '../../../src/lib/offline-maps/profile.ts';
/** CLI/config is trusted operator input; never infer policy from package descriptors. */
export function readerFor(publicRoot: string): ManifestReader {
	const url = new URL(publicRoot);
	if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
		throw new Error('Public package root must be an HTTPS URL without credentials/query/fragment');
	}
	return { version: 1, allowedOrigins: [url.origin], profiles: [PROFILE] };
}
