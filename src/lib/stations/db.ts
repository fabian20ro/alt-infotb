import type { Station } from './types.js';

const DB_NAME = 'alt-stb';
const DB_VERSION = 1;
const STORE_NAME = 'stations';
const META_STORE = 'meta';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE);
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Read all stations from IndexedDB */
export async function getStations(): Promise<Station[]> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const store = tx.objectStore(STORE_NAME);
		const request = store.getAll();
		request.onsuccess = () => resolve(request.result as Station[]);
		tx.oncomplete = () => db.close();
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
		request.onerror = () => reject(request.error);
	});
}

/** Write stations to IndexedDB and update the refresh timestamp */
export async function saveStations(stations: Station[]): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		const meta = tx.objectStore(META_STORE);

		// Clear old data and insert fresh
		store.clear();
		for (const station of stations) {
			store.put(station);
		}
		meta.put(Date.now(), 'lastRefresh');

		tx.oncomplete = () => { db.close(); resolve(); };
		tx.onerror = () => { db.close(); reject(tx.error); };
		tx.onabort = () => db.close();
	});
}

/** Get the timestamp of the last station data refresh */
export async function getLastRefreshTime(): Promise<number> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(META_STORE, 'readonly');
		const store = tx.objectStore(META_STORE);
		const request = store.get('lastRefresh');
		request.onsuccess = () => resolve((request.result as number) ?? 0);
		tx.oncomplete = () => db.close();
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
		request.onerror = () => reject(request.error);
	});
}

/** Update only the last refresh timestamp without re-saving station data */
export async function updateLastRefreshTime(): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(META_STORE, 'readwrite');
		const store = tx.objectStore(META_STORE);
		store.put(Date.now(), 'lastRefresh');
		tx.oncomplete = () => { db.close(); resolve(); };
		tx.onerror = () => { db.close(); reject(tx.error); };
		tx.onabort = () => db.close();
	});
}

/** Check whether stations have been loaded into IndexedDB */
export async function hasStations(): Promise<boolean> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const store = tx.objectStore(STORE_NAME);
		const request = store.getAllKeys();
		request.onsuccess = () => resolve(request.result.length > 0);
		tx.oncomplete = () => db.close();
		tx.onerror = () => db.close();
		tx.onabort = () => db.close();
		request.onerror = () => reject(request.error);
	});
}
