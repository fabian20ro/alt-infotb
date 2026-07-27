import { describe, it, expect } from 'vitest';
import { normalize, searchStations } from './search.js';
import type { Station } from './types.js';

describe('searchStations', () => {
	const stations: Station[] = [
		{ id: 1, name: 'A', description: 'This is a description', lat: 0, lon: 0 },
		{ id: 2, name: 'Piata Unirii', description: 'Central hub', lat: 44, lon: 26 },
		{ id: 3, name: 'Piata Romana', description: 'Another hub', lat: 44, lon: 26 },
	];

	it('finds matches where query is in description', () => {
		const results = searchStations('description', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('A');
	});

	it('finds matches where query is in description with low score', () => {
		const results = searchStations('Is a description', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('A');
	});

	it('respects maxResults', () => {
		const results = searchStations('Piata', stations, 2);
		expect(results).toHaveLength(2);
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('respects maxResults with 1', () => {
		const results = searchStations('Piata', stations, 1);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('finds matches with split words (new functionality)', () => {
		// "Uni" and "Hub" are present in Piata Unirii / Central hub
		const results = searchStations('Uni Hub', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('handles acronyms correctly', () => {
		const stationsWithAcronym = [
			{ id: 4, name: 'C.F.R. Station', description: 'Acronym test', lat: 0, lon: 0 }
		] as Station[];
		const results = searchStations('cfr', stationsWithAcronym);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('C.F.R. Station');
	});

	it('finds station by numeric ID', () => {
		const stations: Station[] = [
			{ id: 1, name: 'S1', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'S2', description: '', lat: 0, lon: 0 },
		];
		expect(searchStations('1', stations)[0].id).toBe(1);
		expect(searchStations('2', stations)[0].id).toBe(2);
	});

	it('matches C.F.R. Station with CFR Station', () => {
		const stationsWithAcronym = [
			{ id: 4, name: 'C.F.R. Station', description: 'Acronym test', lat: 0, lon: 0 }
		] as Station[];
		const results = searchStations('CFR Station', stationsWithAcronym);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('C.F.R. Station');
	});

	it('returns empty array for null query', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
		];
		expect(searchStations(null as any, stations)).toEqual([]);
	});

	it('returns empty array for undefined query', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
		];
		expect(searchStations(undefined as any, stations)).toEqual([]);
	});

	it('returns empty array for tab/newline whitespace-only query on searchStations with data', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
			{ id: 2, name: 'Beta', description: 'data', lat: 0, lon: 0 },
		];
		expect(searchStations('   \t\n  ', stations)).toEqual([]);
	});

	it('does not throw on non-string query types and finds numeric match', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
			{ id: 9999, name: 'Niner', description: '', lat: 0, lon: 0 },
		];
		expect(() => searchStations(42 as any, stations)).not.toThrow();
		expect(searchStations(42 as any, stations)).toEqual([]);
		// Verify numeric-ID path actually resolves via number coercion
		const numResult = searchStations(9999 as any, stations);
		expect(numResult).toHaveLength(1);
		expect(numResult[0].id).toBe(9999);
	});

	it('returns empty array for numeric query with no matching station ID', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
			{ id: 2, name: 'Beta', description: 'data', lat: 0, lon: 0 },
		];
		expect(searchStations('9999', stations)).toEqual([]);
	});

	it('does not throw on non-array station list', () => {
		expect(() => searchStations('test', null as any)).not.toThrow();
		expect(searchStations('test', null as any)).toEqual([]);
	});

	it('returns empty array for empty stations list', () => {
		expect(searchStations('anything', [])).toEqual([]);
	});

	it('ranks exact match above word-boundary/all-words and description-only matches', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Bun test query', description: '', lat: 0, lon: 0 },
			{ id: 2, name: 'XYZ Info', description: 'Has Bun test query text', lat: 0, lon: 0 },
			{ id: 3, name: 'Bun something Query test here', description: '', lat: 0, lon: 0 },
		];
		const results = searchStations('bun test query', stations);
		expect(results.map(s => s.id)).toEqual([1, 3, 2]);
	});

	it('ranks starts-with above word-boundary match when both exist', () => {
		const stations: Station[] = [
			{ id: 10, name: 'StartWithMe extra stuff', description: '', lat: 0, lon: 0 },
			{ id: 11, name: 'Random StartWithMe word', description: '', lat: 0, lon: 0 },
			{ id: 22, name: 'XYZ', description: 'StartWithMe content here', lat: 0, lon: 0 },
		];
		const results = searchStations('startwithme', stations);

		// Three individual assertions make failures failure-specific:
		// if any rank breaks, you immediately know which match type is wrong.
		expect(results[0].id).toBe(10); // starts-with (score ~85) ranks first
		expect(results[1].id).toBe(11); // word-boundary (score ~65) ranks second
		expect(results[2].id).toBe(22); // description-only (score ~29) ranks third
	});

	it('ranks starts-with above description-only when both exist for the same query', () => {
		const stations: Station[] = [
			{ id: 30, name: 'StartWithMe stuff', description: '', lat: 0, lon: 0 },
			{ id: 40, name: 'XYZ', description: 'StartWithMe content', lat: 0, lon: 0 },
		];
		const results = searchStations('startwithme', stations);
		expect(results.map(s => s.id)).toEqual([30, 40]);
	});

	it('ranks all-words match split across name+description above description-only when words are spread differently', () => {
		// Query "hello world": station A has both in name (10 + 2*5 = 20),
		// station B has one word in name, other in desc (10 + 1*5 = 15),
		// station C only matches via description (score 20 from desc match).
		const stations: Station[] = [
			{ id: 1, name: 'Hello World', description: '', lat: 0, lon: 0 },              // both in name → score ~35
			{ id: 2, name: 'Hello there', description: 'World text here', lat: 0, lon: 0 }, // hello in name + world in desc (all words) → 10+1*5 = 15
			{ id: 3, name: 'Foo Bar Baz', description: 'hello world content', lat: 0, lon: 0 }, // desc only match → score 20
		];
		const results = searchStations('hello world', stations);
		expect(results.map(s => s.id)).toEqual([1, 3, 2]);

		// Verify scores reflect the formula: all-in-name > desc-only > mixed-all-words
		function expectedScore(station: Station): number {
			const nName = normalize(station.name);
			const nDesc = normalize(station.description);
			const words = 'hello world'.split(' ').filter(w => w.length > 0);
			if (nName === 'hello world') return 100;
			if (nName.startsWith('hello world')) return 80;
			if (nName.endsWith('hello world') || nName.includes(' hello world') || nName.includes('hello world ')) return 60;
			if (nDesc.includes('hello world')) return 20;
			const nm = words.filter(w => nName.includes(w)).length;
			const dm = words.filter(w => nDesc.includes(w)).length;
			if (nm + dm === words.length) {
				let s = 10 + nm * 5;
				s += Math.max(0, 10 - nName.length / 5);
				return s;
			}
			return 0;
		}

		const scores = results.map(r => expectedScore(r));
		expect(scores[0]).toBeGreaterThan(scores[2]); // A > C (all-in-name vs desc-only)
		expect(scores[2]).toBeGreaterThan(scores[1]); // C > B (desc-only 20+bonus > mixed-all-words ~15+bonus)
	});

	it('matches partial-word fragments via space-padded word-boundary check', () => {
		// "uniri" is a fragment of "Unirii". The code's ends-with/word-boundary check uses
		// includes(\` ${query}\`) which catches the leading-space match in 'piata unirii'.
		const stations: Station[] = [
			{ id: 1, name: 'Piata Unirii', description: 'Central hub', lat: 0, lon: 0 },
		];
		const results = searchStations('uniri', stations);
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(1);
	});

	it('prioritizes numeric ID search over name-based search', () => {
		const stations: Station[] = [
			{ id: 42, name: 'Station 42', description: '', lat: 0, lon: 0 },
			{ id: 100, name: 'Other Station', description: 'About 42 things', lat: 0, lon: 0 },
		];
		const results = searchStations('42', stations);

		// Failure-specific assertions — catches regressions where numeric ID priority
		// is lost (e.g. if the early return on line 28-29 is removed or the sort breaks):
		expect(results).toHaveLength(1); // station id=100 excluded despite "42" in description
		expect(results[0].id).toBe(42);   // exact numeric match wins

		const ids = results.map(s => s.id);
		expect(ids).toEqual([42]);         // no name-based match leaks through
	});

	it('breaks ties by shorter name when startswith scores are equal', () => {
		const stations: Station[] = [
			{ id: 30, name: 'Alfa Centauri Major', description: '', lat: 0, lon: 0 },
			{ id: 31, name: 'Alfa', description: '', lat: 0, lon: 0 },
		];
		const results = searchStations('alfa', stations);
		expect(results.map(s => s.id)).toEqual([31, 30]);

		// verify the short-name bonus is actually applied (both are starts-with)
		const scored = results.map(r => ({
			id: r.id,
			score: searchStations('alfa', [r])[0].id === r.id ? 80 + Math.max(0, 10 - normalize(r.name).length / 5) : 0,
		}));

		const alfaScore = scored.find(s => s.id === 31);
		const centauriScore = scored.find(s => s.id === 30);
		expect(alfaScore!.score).toBeGreaterThan(centauriScore!.score!);
	});

	it('ranks ends-with match above description-only but below starts-with', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Unirii Piata', description: '', lat: 0, lon: 0 },   // query "piata" at end → ends-with score 60
			{ id: 2, name: 'Piata Unirii', description: '', lat: 0, lon: 0 },   // query "piata" at start → starts-with score 80
			{ id: 3, name: 'XYZ Hub', description: 'unirii piata text here', lat: 0, lon: 0 }, // desc only → score 20
		];
		const results = searchStations('piata', stations);

		// Three individual assertions make failures failure-specific — same pattern as starts-with ranking test:
		expect(results[0].id).toBe(2);  // starts-with (score ~85) ranks first
		expect(results[1].id).toBe(1);  // ends-with (score ~62) ranks second
		expect(results[2].id).toBe(3);  // description-only (score ~29) ranks third
	});

	it('excludes stations when multi-word query has partial (not full) word match', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Hello World Extra', description: '', lat: 0, lon: 0 },       // all 3 words in name → included
			{ id: 2, name: 'Foo Bar Baz', description: '', lat: 0, lon: 0 },              // no match at all → excluded
			{ id: 3, name: 'Partial Hello Only', description: '', lat: 0, lon: 0 },       // only "hello" in name (1/3) → excluded
		];
		const results = searchStations('hello world extra', stations);
		expect(results.map(s => s.id)).toEqual([1]);
	});

	it('scores all-words match with name+description split correctly', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Hello World', description: '', lat: 0, lon: 0 },              // 2 word matches in name → 10 + 2*5 = 20
			{ id: 2, name: 'Foo Bar Baz', description: 'Hello World text', lat: 0, lon: 0 }, // 0 name + 2 desc = 2 → 10 + 0*5 = 10
			{ id: 3, name: 'Partial Hello Only', description: '', lat: 0, lon: 0 },       // only "hello" in name → partial → excluded
		];
		const results = searchStations('hello world', stations);
		expect(results.map(s => s.id)).toEqual([1, 2]);
	});

	it('ranks all-word match above description-only when both exist for a multi-word query', () => {
		const stations: Station[] = [
			{ id: 20, name: 'Hello World', description: '', lat: 0, lon: 0 },
			{ id: 21, name: 'No match here', description: 'Hello World content', lat: 0, lon: 0 },
		];
		const results = searchStations('hello world', stations);
		expect(results.map(s => s.id)).toEqual([20, 21]);
	});

	it('computes all-words score correctly when words split across name and description fields', () => {
		// Forces the code path at lines 53-59: detectMatchType returns 0 → multi-word check.
		// Station A ("hello extra" / "world text here"): 1 word in name, 1 word in desc → all-words score = 10 + 1*5 = 15 + short-name bonus (~7.4) ≈ 22.4.
		// Station B ("foo bar baz" / "hello world content"): both words only in desc → detectMatchType returns 20 (desc match). All-words score = 10 + 0*5 = 10 + bonus (~7.6) ≈ 17.6.
		// Result: B ranks above A because desc-only base (20) beats mixed-split all-words with only 1 name match.
		const stations: Station[] = [
			{ id: 20, name: 'Hello Extra', description: 'World text here', lat: 0, lon: 0 },
			{ id: 21, name: 'Foo Bar Baz', description: 'Hello World content', lat: 0, lon: 0 },
		];

		const results = searchStations('hello world', stations);
		expect(results).toHaveLength(2);
		expect(results[0].id).toBe(21); // desc-only base wins over low nameMatches all-words
		expect(results[1].id).toBe(20); // mixed split with 1/2 in name
	});

	it('all-words score increases with more name matches', () => {
		const stations: Station[] = [
			{ id: 30, name: 'Hello World Extra', description: '', lat: 0, lon: 0 },          // both words in name → nameMatches=2 → 10+10=20 + bonus
			{ id: 31, name: 'Hello only', description: 'World text', lat: 0, lon: 0 },        // 1 word in name → nameMatches=1 → 10+5=15 + bonus
		];

		const results = searchStations('hello world', stations);
		expect(results.map(s => s.id)).toEqual([30, 31]); // both in name ranks above mixed split
	});
});

describe('normalize', () => {
	it('removes diacritics', () => {
		expect(normalize('Piata')).toBe('piata');
		expect(normalize('Piățã')).toBe('piata');
	});

	it('handles acronyms with spaces and dots', () => {
		expect(normalize('C. F. R.')).toBe('cfr');
		expect(normalize('C.F.R.')).toBe('cfr');
	});

	it('handles acronyms followed by text without space', () => {
		expect(normalize('C.F.R.Station')).toBe('cfrstation');
	});

	it('treats dashes as spaces', () => {
		expect(normalize('Piata-Unirii')).toBe('piata unirii');
	});

	it('collapses multiple spaces', () => {
		expect(normalize('  Too   Many   Spaces  ')).toBe('too many spaces');
	});

	it('strips decomposed combining diacritic marks (e.g., base + U+0326)', () => {
		// Unicode normalization NFD converts pre-combined to base + combining mark;
		// the regex then strips the combining mark entirely.
		// 'S' + combining dot below (U+0326) → after NFD: 'S̥' which is treated as a new char and stripped, yielding 'stion'.
		expect(normalize('S\u0326tion')).toBe('stion');
	});

	it('returns empty array for whitespace-only query', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
		];
		expect(searchStations('   ', stations)).toEqual([]);
	});

	it('returns empty array for punctuation-only query', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'test', lat: 0, lon: 0 },
		];
		expect(searchStations('...!!!', stations)).toEqual([]);
	});

	it('strips decomposed diacritics and still finds matches by name', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Piata Unirii', description: 'Hub', lat: 0, lon: 0 },
		];
		// Query with decomposed diacritic on 't': t + combining caron
		const results = searchStations('Pia\u030Cta', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Piata Unirii');
	});

	it('strips decomposed diacritics and still finds matches via description', () => {
		const stations: Station[] = [
			{ id: 1, name: 'Alpha', description: 'Cafenea cu cozonac', lat: 0, lon: 0 },
		];
		// Query with decomposed diacritic on 'a': a + combining acute (U+0301) which is in [U+0300-U+036F] range stripped by normalize
		const results = searchStations('cozo\u0301nac', stations);
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe('Alpha');
	});
});
