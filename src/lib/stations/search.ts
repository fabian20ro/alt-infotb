import type { Station } from './types.js';

export function normalize(text: string): string {
	let res = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
	// Handle acronyms like C.F.R. or C. F. R.
	// Match: start of word, then (dot, optional space, letter/number) repeated, then optional dot.
	res = res.replace(/\b[a-z0-9](?:[\.\-\s]+[a-z0-9])*[\.\-]*[a-z0-9]*/gi, (m) => m.replace(/[\s\.\-]/g, ''));
	return res
		.replace(/[^a-z0-9\s]/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** Detect the highest-priority match type between a normalized query and station fields.
 *  Returns a score (higher = better) or 0 if no match is found. */
function detectMatchType(query: string, name: string, desc: string): number {
	if (name === query) return 100;
	if (name.startsWith(query)) return 80;
	if (name.endsWith(query) || name.includes(` ${query}`) || name.includes(`${query} `)) return 60;
	if (name.includes(query)) return 30;
	if (desc.includes(query)) return 20;

	return 0;
}

/** Fuzzy search stations by name. Normalizes diacritics, punctuation, and whitespace before scoring. Returns matches sorted by relevance. */
export function searchStations(
	query: string | null | undefined,
	stations: readonly Station[] | null | undefined,
	maxResults = 20
): Station[] {
	const normalizedQuery = normalize(String(query ?? ''));
	if (normalizedQuery.length === 0 || !stations) return [];

	// Check if query is a numeric ID
	if (/^\d+$/.test(normalizedQuery)) {
		const queryId = parseInt(normalizedQuery, 10);
		const idMatch = stations.find(s => s.id === queryId);
		if (idMatch) return [idMatch];
	}

	const queryWords = normalizedQuery.split(' ').filter(w => w.length > 0);

	const scored: Array<{ station: Station; score: number }> = [];

	for (const station of stations) {
		const normalizedName = normalize(station.name);
		const normalizedDesc = normalize(station.description);

		let score = detectMatchType(normalizedQuery, normalizedName, normalizedDesc);

		// All words present across name and description fields.
		if (score === 0 && queryWords.length > 1 && queryWords.every(w => normalizedName.includes(w) || normalizedDesc.includes(w))) {
			const nameMatches = queryWords.filter(w => normalizedName.includes(w)).length;
			score = 10 + (nameMatches * 5);
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
