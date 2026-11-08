import { describe, expect, it } from 'vitest';
import { revisionManifest } from './offline-preview-package.ts';
import type { OfflineMapManifest } from '../src/lib/offline-maps/manifest.ts';

describe('local offline preview update fixture', () => {
	const original = { version: '20261106-v1', dataDate: '2026-11-06', baseUrl: 'https://preview.invalid/packages/bucuresti-ilfov/20261106-v1/',
		archive: { path: 'map.pmtiles', bytes: 42, sha256: 'a'.repeat(64) }, assets: [{ path: 'light.json' }], totalBytes: 100 } as OfflineMapManifest;
	it('changes only logical identity, never archive or asset descriptors', () => {
		const next = revisionManifest(original, 2);
		expect(next).toEqual({ ...original, version: '20261106-v2', baseUrl: 'https://preview.invalid/packages/bucuresti-ilfov/20261106-v2/' });
		expect(next.archive).toBe(original.archive);
		expect(next.assets).toBe(original.assets);
		expect(original.version).toBe('20261106-v1');
	});
	it.each([0, -1, 3, 1.1, NaN, Infinity])('rejects unsupported fixture revision %s', revision => {
		expect(() => revisionManifest(original, revision)).toThrow('Invalid PREVIEW_PACKAGE_REVISION');
	});
});
