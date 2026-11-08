/** Preview-only browser shell. The default build never imports this module. */
import { acquireShellReader } from './shell-reader';
import { OFFLINE_SHELL_PROTOCOL } from './shell-protocol';

interface InstallPrompt extends Event {
 prompt(): Promise<void>;
 userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export interface OfflineShellState {
 ready: boolean;
 updateAvailable: boolean;
 installAvailable: boolean;
 standalone: boolean;
 error: null | 'unavailable' | 'busy' | 'other-tabs';
}
interface ShellStatus { version: string; complete: boolean }
const version = __OFFLINE_SHELL_VERSION__;
const listeners = new Set<() => void>();
let state: OfflineShellState = { ready: false, updateAvailable: false, installAvailable: false, standalone: false, error: null };
let registration: ServiceWorkerRegistration | undefined;
let prompt: InstallPrompt | undefined;
let startup: Promise<void> | undefined;
let busy = false;
let scope = '';
let readerToken: string | undefined;
const emit = () => { state = { ...state }; for (const fn of listeners) fn(); };
function message<T>(worker: ServiceWorker, data: unknown): Promise<T> {
 return new Promise((resolve, reject) => {
  const channel = new MessageChannel();
  const finish = () => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); };
  const timer = setTimeout(() => { finish(); reject(new Error('Offline shell did not respond')); }, 8_000);
  channel.port1.onmessage = event => { finish(); resolve(event.data as T); };
  try { worker.postMessage(data, [channel.port2]); } catch (error) { finish(); reject(error); }
 });
}
async function status(): Promise<ShellStatus | null> {
 const controller = navigator.serviceWorker?.controller;
 if (!controller || !registration?.active || controller.scriptURL !== registration.active.scriptURL) return null;
 try { return await message<ShellStatus>(controller, {
  type: 'OFFLINE_SHELL_STATUS', protocol: OFFLINE_SHELL_PROTOCOL, readerVersion: version, readerToken
 }); } catch { return null; }
}
async function isReady(): Promise<boolean> {
 const result = await status();
 return !!result?.complete && result.version === version;
}
async function refresh() {
 const result = await status();
 state.ready = !!result?.complete && result.version === version;
 state.updateAvailable = !!registration?.waiting || !!result && result.version !== version;
 state.standalone = matchMedia('(display-mode: standalone)').matches;
 state.installAvailable = !!prompt && !state.standalone;
 emit();
}
async function start() {
 if (startup) return startup;
 startup = (async () => {
  if (!isSecureContext || !('serviceWorker' in navigator)) throw new Error('Unsupported shell');
  // This entry point is restricted to local preview origins. A production URL
  // can never activate the experimental worker, even with a copied preview build.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Local preview only');
  scope = new URL('./', document.baseURI).href;
  // SvelteKit uses an explicit base; pages are served at its root in this preview.
  const { base } = await import('$app/paths');
  scope = new URL(`${base}/`, location.origin).href;
  if (!navigator.locks) throw new Error('Offline shell locks unavailable');
  readerToken = crypto.randomUUID();
  await acquireShellReader(navigator.locks, scope, version, readerToken);
  window.addEventListener('beforeinstallprompt', event => {
   event.preventDefault(); prompt = event as InstallPrompt; state.installAvailable = true; emit();
  });
  window.addEventListener('appinstalled', () => { prompt = undefined; void refresh(); });
  navigator.serviceWorker.addEventListener('controllerchange', () => { void refresh(); });
  window.addEventListener('focus', () => { void refresh(); });
  window.addEventListener('pageshow', () => { void refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  registration = await navigator.serviceWorker.register(`${base}/service-worker-offline.js`, { scope: `${base}/`, updateViaCache: 'none' });
  registration.addEventListener('updatefound', () => {
   const installing = registration?.installing;
   installing?.addEventListener('statechange', () => { if (installing.state === 'installed') void refresh(); });
  });
  // First install activates naturally; updates stay waiting until the user agrees.
  await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Shell installation timeout')), 20_000))]);
  await refresh();
 })().catch(() => { state.error = 'unavailable'; emit(); });
 return startup;
}
/** Shared for the full mutation/swap, so app activation cannot race a new operation. */
async function runOperation<T>(action: () => Promise<T>): Promise<T> {
 if (!navigator.locks || !scope) throw new Error('Offline shell locks unavailable');
 return navigator.locks.request(`offline-shell:${scope}:transition`, { mode: 'shared' }, action);
}
async function applyUpdate(): Promise<void> {
 if (busy) { state.error = 'busy'; emit(); return; }
 if (!navigator.locks || !scope) { state.error = 'unavailable'; emit(); return; }
 await navigator.locks.request(`offline-shell:${scope}:transition`, { mode: 'exclusive', ifAvailable: true }, async lock => {
  if (!lock || busy) { state.error = 'busy'; emit(); return; }
  state.error = null;
  const waiting = registration?.waiting;
  if (waiting) {
   // Install must be complete before requesting activation. No blind SKIP_WAITING.
   const candidate = await message<ShellStatus>(waiting, { type: 'OFFLINE_SHELL_STATUS' });
   if (!candidate.complete) throw new Error('Incomplete replacement shell');
   const changed = new Promise<void>((resolve, reject) => {
    const listener = () => { clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', listener); resolve(); };
    const timer = setTimeout(() => { navigator.serviceWorker.removeEventListener('controllerchange', listener); reject(new Error('Activation timeout')); }, 10_000);
    navigator.serviceWorker.addEventListener('controllerchange', listener);
   });
   // Attach rejection now so a failed message cannot leave an unhandled timer.
   void changed.catch(() => {});
   await message(waiting, { type: 'OFFLINE_SHELL_ACTIVATE' });
   await changed;
  } else {
   const current = await status();
   if (!current?.complete || current.version === version) return;
  }
  location.reload();
 }).catch(() => { state.error = 'unavailable'; emit(); });
}
async function requestInstall() {
 const selected = prompt;
 if (!selected) return;
 // prompt() runs synchronously in the click handler before yielding user activation.
 prompt = undefined; state.installAvailable = false; emit();
 try { await selected.prompt(); await selected.userChoice; await refresh(); }
 catch { state.error = 'unavailable'; emit(); }
}
export const offlineShell = {
 get state() { return state; },
 subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
 start, isReady, refresh, runOperation, applyUpdate, requestInstall,
 setBusy(value: boolean) { busy = value; }
};
