import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('recents store', () => {
	beforeEach(() => {
		const store: Record<string, string> = {};
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => store[key] ?? null,
			setItem: (key: string, value: string) => { store[key] = value; },
			removeItem: (key: string) => { delete store[key]; },
			clear: () => { Object.keys(store).forEach((k) => delete store[k]); }
		});
	});

	it('starts with empty recents', async () => {
		const { createRecentsStore } = await import('./recents.svelte.js');
		const store = createRecentsStore();
		expect(store.recents).toEqual([]);
	});

	it('getExcluding filters out favorite IDs', async () => {
		const stations = [
			{ id: 1, name: 'A', description: '', lat: 44.4, lon: 26.1 },
			{ id: 2, name: 'B', description: '', lat: 44.4, lon: 26.1 },
			{ id: 3, name: 'C', description: '', lat: 44.4, lon: 26.1 },
		];
		localStorage.setItem('better-stb-recents', JSON.stringify(stations));

		const { createRecentsStore } = await import('./recents.svelte.js');
		const store = createRecentsStore();
		const result = store.getExcluding(new Set([2]));
		expect(result).toHaveLength(2);
		expect(result.map((r) => r.id)).toEqual([1, 3]);
	});
});
