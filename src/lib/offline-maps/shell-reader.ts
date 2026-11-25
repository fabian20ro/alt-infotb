import { isShellReaderToken, isShellVersion, shellDocumentLock, shellLifecycleLock, shellReaderLock } from './shell-protocol';

/** Pin lazy assets for the document lifetime, including background/frozen pages.
 * Only the browser releases this lease when the document is destroyed. Releasing
 * on pagehide or a component unmount would invalidate resumable old documents.
 */
export async function acquireShellReader(locks: Pick<LockManager, 'request'>, scope: string, version: string, token: string): Promise<void> {
	if (!isShellVersion(version)) throw new Error('Invalid offline shell version');
	if (!isShellReaderToken(token)) throw new Error('Invalid offline shell reader token');
	function hold(name: string, mode: LockMode) {
		return new Promise<void>((resolve, reject) => {
			void locks.request(name, { mode }, lock => {
				if (!lock) throw new Error('Offline shell reader unavailable');
				resolve();
				return new Promise<void>(() => {});
			}).catch(reject);
		});
	}
	await locks.request(shellLifecycleLock(scope), { mode: 'shared' }, async () => {
		await hold(shellReaderLock(scope, version), 'shared');
		// Some browsers expose different client IDs through Web Locks and the SW.
		// This unique held lock lets the worker bind its actual message sender to
		// the common version reader without equating those unrelated IDs.
		await hold(shellDocumentLock(scope, version, token), 'exclusive');
	});
}
