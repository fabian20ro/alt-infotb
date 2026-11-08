import { isShellVersion, shellLifecycleLock, shellReaderLock } from './shell-protocol';

/** Pin lazy assets for the document lifetime, including background/frozen pages.
 * Only the browser releases this lease when the document is destroyed. Releasing
 * on pagehide or a component unmount would invalidate resumable old documents.
 */
export async function acquireShellReader(locks: Pick<LockManager, 'request'>, scope: string, version: string): Promise<void> {
	if (!isShellVersion(version)) throw new Error('Invalid offline shell version');
	await locks.request(shellLifecycleLock(scope), { mode: 'shared' }, () => new Promise<void>((resolve, reject) => {
		void locks.request(shellReaderLock(scope, version), { mode: 'shared' }, lock => {
			if (!lock) throw new Error('Offline shell reader unavailable');
			resolve();
			return new Promise<void>(() => {});
		}).catch(reject);
	}));
}
