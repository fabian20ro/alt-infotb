/** Shared by the preview page and its service worker; never imported by production. */
export const OFFLINE_SHELL_PROTOCOL = 1;

export function isShellVersion(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
}

export const shellReaderLock = (scope: string, version: string) => `offline-shell:${scope}:reader:${version}`;
export const shellLifecycleLock = (scope: string) => `offline-shell:${scope}:lifecycle`;
export const shellDocumentLock = (scope: string, version: string, token: string) => `offline-shell:${scope}:document:${version}:${token}`;
export function isShellReaderToken(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}
