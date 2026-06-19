import type { Station } from './types.js';

export function normalize(text: string): string {
	let res = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
	// Handle acronyms like C.F.R. or C. F. R.
	// Match: start of word, then (dot, optional space, letter) repeated, then optional dot.
	// We use a lookahead to ensure we don't swallow the space before the next word.
	res = res.replace(/\b[a-z](?:[\.\s]+[a-z])+(?=\.?\s|\.?$)/gi, (m) => m.replace(/[\s\.]/g, ''));
	return res
		.replace(/[^a-z0-9\s]/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** Fuzzy search stations by name. Normalizes diacritics, punctuation, and whitespace before scoring. Returns matches sorted by relevance. */
export function searchStations(
	query: string,
	stations: readonly Station[],
	maxResults = 20
): Station[] {
	const normalizedQuery = normalize(query);
	if (normalizedQuery.length === 0) return [];

	const queryWords = normalizedQuery.split(' ').filter(w => w.length > 0);

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
		else if (normalizedName.endsWith(normalizedQuery) || normalizedName.includes(` ${normalizedQuery}`) || normalizedName.includes(`${normalizedQuery} `)) {
			score = 60;
		}
		// Description contains query
		else if (normalizedDesc.includes(normalizedQuery)) {
			score = 20;
		}

		// All words present (but not as a contiguous phrase)
		if (score === 0 && queryWords.length > 1) {
			const nameMatches = queryWords.filter(w => normalizedName.includes(w)).length;
			const descMatches = queryWords.filter(w => normalizedDesc.includes(w)).length;
			if (nameMatches + descMatches === queryWords.length) {
				score = 10 + (nameMatches * 5);
			}
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
