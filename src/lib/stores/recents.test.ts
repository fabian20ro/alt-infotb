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
		localStorage.setItem('alt-stb-recents', JSON.stringify(stations));

		const { createRecentsStore } = await import('./recents.svelte.js');
		const store = createRecentsStore();
		const result = store.getExcluding(new Set([2]));
		expect(result).toHaveLength(2);
		expect(result.map((r) => r.id)).toEqual([1, 3]);
	});

	it('add inserts new station at the front', async () => {
		const a = { id: 10, name: 'A', description: '', lat: 44.4, lon: 26.1 };
		const b = { id: 20, name: 'B', description: '', lat: 44.4, lon: 26.1 };

		const { createRecentsStore } = await import('./recents.svelte.js');
		const store = createRecentsStore();
		store.add(a);
		store.add(b);

		expect(store.recents.map((r) => r.id)).toEqual([20, 10]);
	});

	it('add moves an existing station to the front without duplication', async () => {
		const a = { id: 1, name: 'A', description: '', lat: 44.4, lon: 26.1 };
		const b = { id: 2, name: 'B', description: '', lat: 44.4, lon: 26.1 };
		const c = { id: 3, name: 'C', description: '', lat: 44.4, lon: 26.1 };

		const { createRecentsStore } = await import('./recents.svelte.js');
		const store = createRecentsStore();
		store.add(a);
		store.add(b);
		store.add(c);
		expect(store.recents.map((r) => r.id)).toEqual([3, 2, 1]);

		store.add(a); // re-add a → should move to front
		expect(store.recents.map((r) => r.id)).toEqual([1, 3, 2]);
	});

	it('add caps recents at MAX_RECENTS and drops oldest', async () => {
		const make = (id: number) => ({ id, name: `S${id}`, description: '', lat: 44.4, lon: 26.1 });

		const { createRecentsStore } = await import('./recents.svelte.js');
		const store = createRecentsStore();

		for (let i = 1; i <= 5; i++) {
			store.add(make(i));
		}
		expect(store.recents.map((r) => r.id)).toEqual([5, 4, 3, 2, 1]);

		store.add(make(6)); // should drop id=1 (oldest)
		expect(store.recents.map((r) => r.id)).toEqual([6, 5, 4, 3, 2]);
	});
});
