import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { checkMapTiles } from './check-map-tiles.ts';

const valid = () => new Response(Uint8Array.from([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } });
describe('live basemap publication canary', () => {
 it.each([undefined, '', '   ', 'pwa-regression-test-key', 'map-interaction-test-key'])('requires a deployment key before any requests', async key => {
  const request = vi.fn<typeof fetch>();
  await expect(checkMapTiles(key, request)).rejects.toThrow('VITE_CARTO_API_KEY');
  expect(request).not.toHaveBeenCalled();
 });
 it('checks both themes and pixel densities with encoded key and allowed website', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => valid());
  await expect(checkMapTiles(' key+& ', request)).resolves.toEqual(['light@1x', 'light@2x', 'dark@1x', 'dark@2x']);
  expect(request).toHaveBeenCalledTimes(4);
  for (const [url, init] of request.mock.calls) {
   expect(new URL(String(url)).searchParams.get('key')).toBe('key+&');
   expect(init?.headers).toMatchObject({ Origin: 'https://fabian20ro.github.io' });
  }
 });
 it.each([401, 403, 429, 503])('stops on HTTP %s without leaking credentials', async status => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-url-key', { status }));
  await expect(checkMapTiles('private-url-key', request)).rejects.toThrow(`HTTP ${status}`);
  expect(request).toHaveBeenCalledTimes(1);
 });
 it('redacts network exceptions that embed the request URL', async () => {
  await expect(checkMapTiles('private-url-key', vi.fn().mockRejectedValue(new Error('https://example/?key=private-url-key')))).rejects.toThrow('network or response failure');
 });
 it('rejects missing CORS permission and non-image success', async () => {
  await expect(checkMapTiles('key', vi.fn().mockResolvedValue(new Response('image', { headers: { 'Content-Type': 'image/png' } })))).rejects.toThrow('CORS');
  await expect(checkMapTiles('key', vi.fn().mockResolvedValue(new Response('html', { headers: { 'Access-Control-Allow-Origin': '*' } })))).rejects.toThrow('invalid image');
 });
 it('rejects the real HTTP200 API-key placeholder and makes no further probes', async () => {
  const placeholder = await readFile(new URL('../e2e/fixtures/carto-api-key-required.png', import.meta.url));
  const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(placeholder, { headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } }));
  await expect(checkMapTiles('key', request)).rejects.toThrow('known API-key placeholder');
  expect(request).toHaveBeenCalledTimes(1);
 });
 it('bounds a stalled request without waiting indefinitely for abort support', async () => {
  vi.useFakeTimers();
  try {
   const result = expect(checkMapTiles('key', vi.fn().mockImplementation(() => new Promise(() => {})))).rejects.toThrow('timed out');
   await vi.advanceTimersByTimeAsync(10000);
   await result;
   expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
 });
});
