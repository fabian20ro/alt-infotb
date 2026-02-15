import type { Station } from './types.js';

/** Map of Romanian diacritics to ASCII equivalents */
const DIACRITICS: Record<string, string> = {
	ă: 'a', â: 'a', î: 'i', ș: 's', ț: 't',
	Ă: 'A', Â: 'A', Î: 'I', Ș: 'S', Ț: 'T',
	// Legacy encodings sometimes use cedilla variants
	ş: 's', ţ: 't', Ş :'S', Ţ: 'T'
};

/** Strip diacritics and normalize for comparison */
export function normalize(text: string): string {
	return text
		.replace(/[ăâîșțşţĂÂÎȘȚŞŢ]/g, (ch) => DIACRITICS[ch] ?? ch)
		.toLowerCase();
}

/** Fuzzy search stations by name. Returns matches sorted by relevance. */
export function searchStations(
	query: string,
	stations: readonly Station[],
	maxResults = 20
): Station[] {
	const normalizedQuery = normalize(query.trim());
	if (normalizedQuery.length === 0) return [];

	const scored: Array<{ station: Station; score: number }> = [];

	for (const station of stations) {
		const normalizedName = normalize(station.name);
		const normalizedDesc = normalize(station.description);

		let score = 0;

		// Exact match (highest priority)
		if (normalizedName === normalizedQuery) {
			score = 100;
		}
		// Starts with query
		else if (normalizedName.startsWith(normalizedQuery)) {
			score = 80;
		}
		// Word boundary match
		else if (normalizedName.includes(` ${normalizedQuery}`)) {
			score = 60;
		}
		// Contains query anywhere
		else if (normalizedName.includes(normalizedQuery)) {
			score = 40;
		}
		// Description contains query
		else if (normalizedDesc.includes(normalizedQuery)) {
			score = 20;
		}

		if (score > 0) {
			// Prefer shorter names (more specific matches)
			score += Math.max(0, 10 - normalizedName.length / 5);
			scored.push({ station, score });
		}
	}

	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, maxResults).map((s) => s.station);
}
