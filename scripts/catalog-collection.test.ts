import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectTopology, createCollector, sha256, type CollectorOptions } from './catalog-collection.ts';

const START = Date.parse('2026-09-25T08:00:00Z');
const directories: string[] = [];
afterEach(async () => {
 vi.useRealTimers();
 await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function setup(request: CollectorOptions['request'], overrides: Partial<CollectorOptions> = {}) {
 const directory = await mkdtemp(join(tmpdir(), 'stb-collection-test-'));
 directories.push(directory);
 let time = START;
 const sleep = vi.fn(async (ms: number) => { time += ms; });
 const options: CollectorOptions = {
  source: 'test:stb', directory, request, now: () => time, sleep, intervalMs: 0, ...overrides
 };
 return { collector: await createCollector(options), options, directory, sleep, advance: (ms: number) => { time += ms; } };
}

const payload = () => new Response(new Uint8Array([10, 1, 65]));
const path = '/lines?lang=ro';

// Synthetic messages independently encoded from the published STB protobuf schema.
function varint(value: number): number[] {
 const result: number[] = [];
 do { const low = value % 128; value = Math.floor(value / 128); result.push(low | (value ? 128 : 0)); } while (value);
 return result;
}
const integer = (field: number, value: number) => [field << 3, ...varint(value)];
const message = (field: number, value: number[]) => [(field << 3) | 2, ...varint(value.length), ...value];
const string = (field: number, value: string) => message(field, [...new TextEncoder().encode(value)]);
function double(field: number, value: number): number[] {
 const valueBytes = new Uint8Array(8);
 new DataView(valueBytes.buffer).setFloat64(0, value, true);
 return [(field << 3) | 1, ...valueBytes];
}
type Line = { id: number; name: string; rawType: string };
type Stop = { id: number; name: string; lat: number; lon: number };
const lines: Line[] = [{ id: 199, name: 'N109', rawType: 'BUS' }, { id: 66, name: '66', rawType: 'CABLE_CAR' }];
const stops: Stop[] = [
 { id: 6084, name: 'Isovolta', lat: 44.43, lon: 26.2 },
 { id: 6165, name: 'Isovolta', lat: 44.431, lon: 26.201 },
 { id: 9001, name: 'Regional terminus', lat: 44.9, lon: 26.6 }
];
const identity = (line: Line) => [...integer(1, line.id), ...string(2, line.name), ...string(3, line.rawType)];
const registry = (items: Line[]) => new Uint8Array(items.flatMap(line => message(1, identity(line))));
const topology = (line: Line, items: Stop[]) => new Uint8Array([
 ...identity(line), ...items.flatMap(stop => message(12, [
  ...integer(1, stop.id), ...double(2, stop.lat), ...double(3, stop.lon), ...string(4, stop.name)
 ]))
]);
function topologyRequest(options: {
 lines?: Line[];
 finalRegistry?: Line[];
 replace?: (path: string) => Response | undefined;
} = {}) {
 const sourceLines = options.lines ?? lines;
 let registries = 0;
 return vi.fn(async (requestPath: string) => {
  const replacement = options.replace?.(requestPath);
  if (replacement) return replacement;
  if (requestPath === path) {
   return new Response(registry(registries++ > 0 ? options.finalRegistry ?? sourceLines : sourceLines));
  }
  const match = /^\/lines\/(\d+)(?:\/direction\/([01]))?\?lang=ro$/.exec(requestPath);
  if (!match) throw Error(`Unexpected target ${requestPath}`);
  const line = sourceLines.find(line => line.id === Number(match[1]));
  if (!line) throw Error(`Unknown line ${match[1]}`);
  const selected = match[2] === '0' ? stops.slice(0, 2) : match[2] === '1' ? stops.slice(1) : stops;
  return new Response(topology(line, selected));
 });
}

describe('collector retries, pacing and failures', () => {
 it.each([['2', 2000], [new Date(START + 4000).toUTCString(), 4000]])('respects Retry-After %s', async (retryAfter, wait) => {
  const request = vi.fn().mockResolvedValueOnce(new Response('limited', { status: 429, headers: { 'Retry-After': retryAfter } })).mockImplementationOnce(payload);
  const { collector, sleep } = await setup(request);
  expect(await collector.get(path)).toEqual(new Uint8Array([10, 1, 65]));
  expect(request).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledWith(wait);
 });
 it('bounds transient HTTP retries and keeps failed responses out of evidence', async () => {
  const request = vi.fn(async () => new Response('unavailable', { status: 503 }));
  const { collector, sleep } = await setup(request);
  await expect(collector.get(path)).rejects.toMatchObject({ code: 'http', message: 'HTTP 503 after retries' });
  expect(request).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([500, 1000]);
  expect(collector.evidence.size).toBe(0);
 });
 it('bounds network-error retries', async () => {
  const request = vi.fn(async () => { throw Error('connection reset'); });
  const { collector } = await setup(request);
  await expect(collector.get(path)).rejects.toMatchObject({ code: 'network' });
  expect(request).toHaveBeenCalledTimes(3);
 });
 it('aborts timed-out requests and bounds their retries', async () => {
  const request = vi.fn((_path: string, signal: AbortSignal) => new Promise<Response>((_resolve, reject) => {
   signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  }));
  const { collector } = await setup(request, { timeoutMs: 20 });
  vi.useFakeTimers();
  const result = expect(collector.get(path)).rejects.toMatchObject({ code: 'timeout' });
  // Filesystem cache inspection happens before each real timer is installed.
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(60);
  await result;
  expect(request).toHaveBeenCalledTimes(3);
 });
 it('bounds a request implementation that ignores AbortSignal', async () => {
  const request = vi.fn(() => new Promise<Response>(() => {}));
  const { collector } = await setup(request, { timeoutMs: 20 });
  vi.useFakeTimers();
  const result = expect(collector.get(path)).rejects.toMatchObject({ code: 'timeout' });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(60);
  await result;
  expect(request).toHaveBeenCalledTimes(3);
 });
 it('applies the timeout to a stalled response body after headers arrive', async () => {
  const request = vi.fn(async () => new Response(new ReadableStream({ start() {} })));
  const { collector } = await setup(request, { timeoutMs: 20 });
  vi.useFakeTimers();
  const result = expect(collector.get(path)).rejects.toMatchObject({ code: 'timeout' });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(60);
  await result;
  expect(request).toHaveBeenCalledTimes(3);
 });
 it('bounds retries when cancellation of an error response body never settles', async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const request = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 503 }));
  const { collector, sleep } = await setup(request, { timeoutMs: 20 });
  vi.useFakeTimers();
  const result = expect(collector.get(path)).rejects.toMatchObject({ code: 'timeout' });
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(60);
  await result;
  expect(request).toHaveBeenCalledTimes(3);
  expect(cancel).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([500, 1000]);
  expect(collector.evidence.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
 });
 it.each([401, 403])('stops immediately on HTTP %s authentication failure', async status => {
  const request = vi.fn(async () => new Response(null, { status }));
  const { collector, sleep } = await setup(request);
  await expect(collector.get(path)).rejects.toMatchObject({ code: 'auth' });
  expect(request).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
 });
 it.each([412, 502])('does not retry proxy-classified auth failure with HTTP %s', async status => {
  const request = vi.fn(async () => new Response(null, { status, headers: { 'X-Proxy-Error': 'auth-http' } }));
  const { collector, sleep } = await setup(request);
  await expect(collector.get(path)).rejects.toMatchObject({ code: 'auth' });
  expect(request).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
 });
 it('recovers transient upstream 412 responses with bounded backoff and caches only success', async () => {
  const cancel = vi.fn();
  const expired = () => new Response(new ReadableStream({ cancel }), { status: 412 });
  const request = vi.fn().mockImplementationOnce(expired).mockImplementationOnce(expired).mockImplementationOnce(payload);
  const { collector, sleep, directory } = await setup(request);
  expect(await collector.get(path)).toEqual(new Uint8Array([10, 1, 65]));
  expect(request).toHaveBeenCalledTimes(3);
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([500, 1000]);
  expect(collector.evidence.get(path)).toMatchObject({ sha256: sha256(new Uint8Array([10, 1, 65])) });
  const cached = JSON.parse(await readFile(join(directory, `${sha256(path)}.json`), 'utf8'));
  expect([...Buffer.from(cached.body, 'base64')]).toEqual([10, 1, 65]);
  await collector.get(path);
  expect(request).toHaveBeenCalledTimes(3);
 });
 it('caps persistent upstream 412 responses at three attempts and remains fatal auth', async () => {
  const cancel = vi.fn();
  const request = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 412 }));
  const { collector, sleep, directory } = await setup(request);
  await expect(collector.get(path)).rejects.toMatchObject({ code: 'auth', message: 'Authentication failed (HTTP 412 after retries)' });
  expect(request).toHaveBeenCalledTimes(3);
  expect(cancel).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([500, 1000]);
  expect(collector.evidence.size).toBe(0);
  await expect(readFile(join(directory, `${sha256(path)}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
 });
 it('stops upstream 412 retries when the next backoff would exceed the collection budget', async () => {
  const cancel = vi.fn();
  const request = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 412 }));
  const { collector, sleep } = await setup(request, { budgetMs: 1200 });
  await expect(collector.get(path)).rejects.toMatchObject({ code: 'budget' });
  expect(request).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([500]);
  expect(collector.evidence.size).toBe(0);
 });
 it('treats HTTP 200 with no bytes as inconclusive, not success', async () => {
  const { collector } = await setup(async () => new Response(null));
  await expect(collector.get(path)).rejects.toMatchObject({ code: 'empty' });
  expect(collector.evidence.size).toBe(0);
 });
 it('refuses a retry beyond the collection budget', async () => {
  const request = vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '5' } }));
  const { collector, sleep } = await setup(request, { budgetMs: 1000 });
  await expect(collector.get(path)).rejects.toMatchObject({ code: 'budget' });
  expect(request).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
 });
 it('spaces sequential requests', async () => {
  const request = vi.fn(async () => payload());
  const { collector, sleep } = await setup(request, { intervalMs: 100 });
  await collector.get('/first');
  await collector.get('/second');
  expect(sleep).toHaveBeenCalledExactlyOnceWith(100);
 });
 it('never sends a request when pacing would cross the deadline', async () => {
  const request = vi.fn(async () => payload());
  const { collector } = await setup(request, { intervalMs: 200, budgetMs: 100 });
  await collector.get('/first');
  await expect(collector.get('/second')).rejects.toMatchObject({ code: 'budget' });
  expect(request).toHaveBeenCalledTimes(1);
 });
});

describe('checkpoint resume and provenance', () => {
 it('resumes a verified response without network and records its original observation time', async () => {
  const request = vi.fn(async () => payload());
  const { collector, options, advance } = await setup(request);
  await collector.get(path);
  advance(1000);
  const resumed = await createCollector(options);
  expect([...await resumed.get(path)]).toEqual([10, 1, 65]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(resumed.evidence.get(path)).toEqual({ path, sha256: sha256(new Uint8Array([10, 1, 65])), capturedAt: new Date(START).toISOString() });
 });
 it('bypasses a valid checkpoint when fresh observation is required', async () => {
  const request = vi.fn(async () => payload());
  const { collector } = await setup(request);
  await collector.get(path);
  await collector.get(path, true);
  expect(request).toHaveBeenCalledTimes(2);
 });
 it.each([
  ['summer', '2026-09-25T00:59:00Z', '2026-09-25T01:01:00Z'],
  ['winter', '2026-12-25T01:59:00Z', '2026-12-25T02:01:00Z']
 ])('refetches previous-transit-day evidence after the 04:00 Bucharest boundary in %s', async (_season, before, after) => {
  let now = Date.parse(before);
  const request = vi.fn(async () => payload());
  const { collector } = await setup(request, { now: () => now });
  await collector.get(path);
  now = Date.parse(after);
  await collector.get(path);
  expect(request).toHaveBeenCalledTimes(2);
 });
 it.each(['expired', 'future', 'hash', 'path', 'malformed-json', 'missing-body', 'null'] as const)('refetches a %s checkpoint', async mutation => {
  const request = vi.fn(async () => payload());
  const { collector, directory } = await setup(request, { maxAgeMs: 1000 });
  await collector.get(path);
  const cachePath = join(directory, `${sha256(path)}.json`);
  const cached = JSON.parse(await readFile(cachePath, 'utf8'));
  if (mutation === 'expired') cached.capturedAt = new Date(START - 1000).toISOString();
  if (mutation === 'future') cached.capturedAt = new Date(START + 1000).toISOString();
  if (mutation === 'hash') cached.body = Buffer.from('tampered').toString('base64');
  if (mutation === 'path') cached.path = '/different';
  if (mutation === 'missing-body') delete cached.body;
  await writeFile(cachePath, mutation === 'malformed-json' ? '{broken' : mutation === 'null' ? 'null' : JSON.stringify(cached));
  await expect(collector.get(path)).resolves.toEqual(new Uint8Array([10, 1, 65]));
  expect(request).toHaveBeenCalledTimes(2);
 });
 it('refuses to mix checkpoint sources or schema versions', async () => {
  const { options, directory } = await setup(async () => payload());
  await expect(createCollector({ ...options, source: 'different:stb' })).rejects.toThrow('Incompatible checkpoint');
  await writeFile(join(directory, 'identity.json'), JSON.stringify({ version: 999, source: options.source }));
  await expect(createCollector(options)).rejects.toThrow('Incompatible checkpoint');
 });
});

describe('complete topology traversal', () => {
 it('visits every registry line and both directions and resolves all source stops', async () => {
  const request = topologyRequest();
  const { collector } = await setup(request);
  const snapshot = await collectTopology(collector, 'test:stb');
  expect(snapshot.status).toBe('complete');
  expect(snapshot.issues).toEqual([]);
  expect(snapshot.registry).toEqual([
   { ...lines[0], type: 'BUS' }, { ...lines[1], type: 'TROLLEYBUS' }
  ]);
  expect(snapshot.lines).toEqual(lines.map(line => ({ id: line.id, directions: { 0: [6084, 6165], 1: [6165, 9001] }, allStopIds: [6084, 6165, 9001] })));
  expect(snapshot.stops).toEqual(stops);
  expect(request.mock.calls.map(([target]) => target)).toEqual([
   path, '/lines/199?lang=ro', '/lines/199/direction/0?lang=ro', '/lines/199/direction/1?lang=ro',
   '/lines/66?lang=ro', '/lines/66/direction/0?lang=ro', '/lines/66/direction/1?lang=ro', path
  ]);
  expect(snapshot.evidence).toHaveLength(7);
  expect(snapshot.evidence.every(evidence => /^[a-f0-9]{64}$/.test(evidence.sha256))).toBe(true);
 });
 it('includes cached response age in the resumed observation interval', async () => {
  const request = topologyRequest();
  const { collector, options, advance } = await setup(request);
  await collector.get('/lines/199?lang=ro');
  advance(10_000);
  const resumed = await createCollector(options);
  const snapshot = await collectTopology(resumed, 'test:stb');
  expect(snapshot.status).toBe('complete');
  expect(snapshot.startedAt).toBe(new Date(START).toISOString());
  expect(snapshot.completedAt).toBe(new Date(START + 10_000).toISOString());
 });
 it('detects an inventory change during capture', async () => {
  const { collector } = await setup(topologyRequest({ finalRegistry: [...lines, { id: 777, name: 'New', rawType: 'BUS' }] }));
  const snapshot = await collectTopology(collector, 'test:stb');
  expect(snapshot.status).toBe('inconclusive');
  expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'registry-changed', path }));
 });
 it('does not mistake registry ordering changes for inventory changes', async () => {
  const { collector } = await setup(topologyRequest({ finalRegistry: [...lines].reverse() }));
  expect((await collectTopology(collector, 'test:stb')).status).toBe('complete');
 });
 it('retains unknown transport types as explicit coverage failures', async () => {
  const { collector } = await setup(topologyRequest({ lines: [{ id: 888, name: 'Future', rawType: 'FERRY' }] }));
  const snapshot = await collectTopology(collector, 'test:stb');
  expect(snapshot.status).toBe('inconclusive');
  expect(snapshot.registry).toHaveLength(1);
  expect(snapshot.lines).toHaveLength(1);
  expect(snapshot.issues).toContainEqual({ code: 'unknown-type', path: 'line:888', message: 'FERRY' });
 });
 it('keeps a line with a missing direction in the denominator and continues other lines', async () => {
  const request = topologyRequest({ replace: target => target === '/lines/199/direction/1?lang=ro' ? new Response(null, { status: 404 }) : undefined });
  const { collector } = await setup(request);
  const snapshot = await collectTopology(collector, 'test:stb');
  expect(snapshot.status).toBe('inconclusive');
  expect(snapshot.registry).toHaveLength(2);
  expect(snapshot.lines).toHaveLength(2);
  expect(snapshot.lines[0].directions['1']).toEqual([]);
  expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'http', path: '/lines/199/direction/1?lang=ro' }));
 });
 it('rejects a combined detail that omits a directional stop', async () => {
  const { collector } = await setup(topologyRequest({ replace: target => target === '/lines/199?lang=ro' ? new Response(topology(lines[0], stops.slice(0, 2))) : undefined }));
  const snapshot = await collectTopology(collector, 'test:stb');
  expect(snapshot.status).toBe('inconclusive');
  expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'direction-coverage', path: 'line:199' }));
 });
 it('rejects contradictory coordinates for one stop ID', async () => {
  const { collector } = await setup(topologyRequest({ replace: target => target === '/lines/66?lang=ro' ? new Response(topology(lines[1], [{ ...stops[0], lat: 45 }, ...stops.slice(1)])) : undefined }));
  const snapshot = await collectTopology(collector, 'test:stb');
  expect(snapshot.status).toBe('inconclusive');
  expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'stop-conflict', message: 'Conflicting identity/coordinates for stop 6084' }));
 });
 it('rejects detail identity different from the registry', async () => {
  const { collector } = await setup(topologyRequest({ replace: target => target === '/lines/199?lang=ro' ? new Response(topology({ ...lines[0], id: 999 }, stops)) : undefined }));
  const snapshot = await collectTopology(collector, 'test:stb');
  expect(snapshot.status).toBe('inconclusive');
  expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'schema', message: 'Registry/detail identity mismatch' }));
 });
 it('stops the entire scan on authentication failure instead of exhausting the inventory', async () => {
  const request = topologyRequest({ replace: target => target === '/lines/199?lang=ro' ? new Response(null, { status: 403 }) : undefined });
  const { collector } = await setup(request);
  const snapshot = await collectTopology(collector, 'test:stb');
  expect(snapshot.status).toBe('inconclusive');
  expect(snapshot.registry).toHaveLength(2);
  expect(snapshot.issues).toContainEqual(expect.objectContaining({ code: 'auth' }));
  expect(request.mock.calls.map(([target]) => target)).toEqual([path, '/lines/199?lang=ro']);
 });
});
