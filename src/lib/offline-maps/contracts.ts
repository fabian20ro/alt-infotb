import type { ManifestReader, OfflineMapManifest, PackageFile } from './manifest.ts';

/** Supplied by trusted configuration/catalog, never by the manifest it authenticates. */
export interface PackageOffer { manifestUrl: string; manifestSha256: string }
export interface Generation { id: string; manifest: OfflineMapManifest; manifestSha256: string }
export interface Journal {
	schemaVersion: 1;
	active: Generation | null;
	previous: Generation | null;
	candidate: Generation | null;
	pendingRender: boolean;
	invalidActive: boolean;
	operation: { id: string; phase: 'downloading' | 'verifying' | 'deleting'; cancelled: boolean } | null;
	garbage: Generation[];
}
export const emptyJournal = (): Journal => ({ schemaVersion: 1, active: null, previous: null,
	candidate: null, pendingRender: false, invalidActive: false, operation: null, garbage: [] });

export interface MetadataRepository {
	read(): Promise<Journal>;
	/** One short transaction. The updater is synchronous and must not perform I/O. */
	change(update: (current: Journal) => Journal): Promise<Journal>;
}
export interface GenerationStore {
	create(generation: Generation): Promise<void>;
	/** Consume the entire verified stream before closing; abort the write on any error. */
	write(generation: Generation, file: PackageFile, stream: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<void>;
	inspect(generation: Generation): Promise<boolean>;
	archive(generation: Generation): Promise<Blob>;
	asset(generation: Generation, path: string): Promise<Blob>;
	/** Idempotent, exact generation only; never origin-wide eviction. */
	remove(generation: Generation): Promise<void>;
}
export interface LockLease { release(): Promise<void> }
export interface Locks {
	acquire(name: string, mode: 'shared' | 'exclusive', options?: { ifAvailable?: boolean; signal?: AbortSignal }): Promise<LockLease | null>;
}
export type Persistence = 'granted' | 'not-granted' | 'unavailable';
export interface StoragePolicy {
	estimate(): Promise<{ usage?: number; quota?: number }>;
	persisted(): Promise<Persistence>;
	/** Call only from an explicit user gesture. Never called by install/recover. */
	requestPersistence(): Promise<Persistence>;
}
export interface PackageTransport {
	manifest(offer: PackageOffer, reader: ManifestReader, signal: AbortSignal): Promise<OfflineMapManifest>;
	/** Bounded size + incremental SHA256; fail if the final bytes do not match. */
	file(generation: Generation, file: PackageFile, signal: AbortSignal): AsyncIterable<Uint8Array>;
}
export interface ChangeBus {
	publish(): void;
	subscribe(listener: () => void): () => void;
}
export interface ManagerPorts {
	metadata: MetadataRepository;
	files: GenerationStore;
	locks: Locks;
	storage: StoragePolicy;
	transport: PackageTransport;
	bus: ChangeBus;
	/** Profile-specific browser checks; no package-supplied executable code. */
	validate(generation: Generation, signal: AbortSignal): Promise<void>;
	/** True only when the consumer's shell/worker/chunks are available offline. */
	shellReady(): Promise<boolean>;
	newId(): string;
}
export interface ManagerConfig { namespace: string; regionId: string; reader: ManifestReader }
export interface PackageSnapshot {
	availability: 'absent' | 'ready' | 'damaged';
	active: Generation | null;
	previous: Generation | null;
	pendingRender: boolean;
	operation: 'idle' | 'downloading' | 'verifying' | 'deleting' | 'cleanup-deferred';
	progress: { bytes: number; total: number } | null;
	pendingDeletionCount: number;
	persistence: Persistence;
}
export interface ReaderLease {
	generation: Generation;
	archive(): Promise<Blob>;
	asset(path: string): Promise<Blob>;
	close(): Promise<void>;
}
