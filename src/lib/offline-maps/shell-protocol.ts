/** Shared by the preview page and its service worker; never imported by production. */
export const OFFLINE_SHELL_PROTOCOL = 1;

export function isShellVersion(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
}

export const shellReaderLock = (scope: string, version: string) => `offline-shell:${scope}:reader:${version}`;
export const shellLifecycleLock = (scope: string) => `offline-shell:${scope}:lifecycle`;
