<script lang="ts">
	import { onMount, type ComponentProps } from 'svelte';
	import { base } from '$app/paths';
	import previewConfig from 'virtual:offline-preview-config';
	import MapView from './MapView.svelte';
	import OfflineMapsPanel from './OfflineMapsPanel.svelte';
	import { translations } from '$lib/i18n/translations.js';
	import { createOfflineMapRuntime } from '$lib/offline-maps/app-runtime.js';
	import type { CoordinatorState, OfflineMapCoordinator } from '$lib/offline-maps/coordinator.js';
	import { offlineShell } from '$lib/offline-maps/shell.js';

	interface Props extends ComponentProps<typeof MapView> { open: boolean; onClose(): void }
	let { open, onClose, allStations, selectedStationId, userPosition, locationPermission,
		locationError = null, lang = 'ro', theme, route = null, overviewRequest = null, onStationSelect }: Props = $props();
	let coordinator = $state.raw<OfflineMapCoordinator | null>(null);
	let view = $state.raw<CoordinatorState | null>(null);
	let shell = $state.raw(offlineShell.state);
	let startupFailed = $state(false);
	let actionFailed = $state(false);
	let checkedOffer = false;
	let strings = $derived(translations[lang]);
	let latestOffer = previewConfig.offers.at(-1);
	let message = $derived.by(() => {
		if (view?.rendererError === 'context-lost') return strings.offlineContextLost;
		if (view?.rendererError === 'offline-data') return strings.offlineDataError;
		if (view?.usingOffline && view.coverage === 'outside') return strings.offlineOutside;
		if (view?.usingOffline && view.coverage === 'partial') return strings.offlinePartial;
		if (view?.rendererError === 'basemap') return strings.offlineRasterError;
		return null;
	});

	function run(action: () => Promise<unknown> | void) {
		actionFailed = false;
		try { void Promise.resolve(action()).catch(error => { if (!(error instanceof Error && error.name === 'AbortError')) actionFailed = true; }); }
		catch { actionFailed = true; }
	}
	function check() { if (latestOffer) run(() => coordinator?.checkUpdate(latestOffer)); }
	function download(repair = false) { if (latestOffer) run(() => coordinator?.install(latestOffer, { repair })); }
	function refresh() { run(async () => { await offlineShell.refresh(); await coordinator?.refresh(); }); }

	onMount(() => {
		let disposed = false;
		let stopCoordinator = () => {};
		const stopShell = offlineShell.subscribe(() => { shell = offlineShell.state; });
		void offlineShell.start().then(() => createOfflineMapRuntime({ ...previewConfig, namespace: `${base}/` }, {
			shellReady: () => offlineShell.isReady(),
			runOperation: (action) => offlineShell.runOperation(action)
		})).then(async created => {
			if (disposed) { await created.dispose(); return; }
			coordinator = created;
			view = created.state;
			stopCoordinator = created.subscribe(() => { view = created.state; });
		}).catch(() => { if (!disposed) startupFailed = true; });
		return () => {
			disposed = true;
			stopShell(); stopCoordinator();
			offlineShell.setBusy(false);
			void coordinator?.dispose().catch(() => {});
		};
	});
	$effect(() => {
		const current = coordinator;
		const language = lang;
		if (current) run(() => current.setLanguage(language));
	});
	$effect(() => { offlineShell.setBusy(view?.busy ?? false); });
	$effect(() => {
		if (open && coordinator && !checkedOffer) { checkedOffer = true; check(); }
	});
</script>

<OfflineMapsPanel {open} {lang} model={view} {startupFailed} {actionFailed} {onClose}
	installAvailable={shell.installAvailable} standalone={shell.standalone}
	updateAvailable={shell.updateAvailable} shellError={shell.error}
	onCheck={check} onDownload={() => download()} onRepair={() => download(true)}
	onUse={() => run(() => coordinator?.useOffline())}
	onOnline={() => run(() => coordinator?.useOnline())}
	onReopen={() => run(() => coordinator?.reopen())}
	onCancel={() => run(() => coordinator?.cancel())}
	onRemove={() => run(() => coordinator?.remove())}
	onPersistence={() => run(() => coordinator?.requestPersistence())}
	onRefresh={refresh} onInstall={() => run(() => offlineShell.requestInstall())}
	onAppUpdate={() => run(() => offlineShell.applyUpdate())}
/>
<div class="offline-map-experience" data-testid="offline-map-status"
	data-source={view?.source ?? 'online'} data-generation={view?.displayedGeneration ?? ''}
	data-coverage={view?.coverage ?? 'unknown'} data-renderer-status={view?.rendererStatus ?? 'loading'}>
	{#if coordinator}
		<MapView {allStations} {selectedStationId} {userPosition} {locationPermission} {locationError}
			{lang} {theme} {route} {overviewRequest} {onStationSelect} rendererFactory={coordinator.rendererFactory} />
	{:else if startupFailed}
		<MapView {allStations} {selectedStationId} {userPosition} {locationPermission} {locationError}
			{lang} {theme} {route} {overviewRequest} {onStationSelect} />
	{:else}
		<div class="starting" role="status">{strings.offlineStarting}</div>
	{/if}
	{#if message}
		<div class="notice">
			<p role="status">{message}</p>
			{#if view?.rendererError === 'context-lost'}
				<button onclick={() => run(() => coordinator?.reopen())}>{strings.offlineReopen}</button>
			{:else if view?.usingOffline && (view.coverage === 'outside' || view.coverage === 'partial')}
				<button onclick={() => run(() => coordinator?.useOnline())}>{strings.offlineOnline}</button>
			{/if}
		</div>
	{/if}
	{#if actionFailed && !open && !view?.error}<p class="notice" role="alert">{strings.offlineActionFailed}</p>{/if}
</div>

<style>
	.offline-map-experience { position: relative; height: min(50dvh, 100vw); flex-shrink: 0; }
	.starting { display: grid; place-items: center; height: 100%; color: var(--color-text-muted); background: var(--color-surface); }
	.notice { position: absolute; top: .5rem; left: .5rem; max-width: min(28rem, calc(100% - 6rem)); z-index: 1100; padding: .5rem .75rem; border-radius: .5rem; background: var(--color-surface); color: var(--color-text); font-size: .8rem; }
	.notice p { margin: 0; }
	.notice button { min-height: 44px; margin-top: .25rem; padding: .25rem .5rem; border: 1px solid var(--color-accent); border-radius: .375rem; background: var(--color-surface); color: var(--color-text); font: inherit; cursor: pointer; }
	.notice button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
</style>
