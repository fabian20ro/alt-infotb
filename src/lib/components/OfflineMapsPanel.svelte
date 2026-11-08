<script lang="ts">
	import type { CoordinatorState } from '$lib/offline-maps/coordinator.js';
	import type { Lang } from '$lib/stores/settings.svelte.js';
	import { translations } from '$lib/i18n/translations.js';

	interface Props {
		open: boolean;
		lang: Lang;
		model: CoordinatorState | null;
		startupFailed: boolean;
		actionFailed: boolean;
		installAvailable: boolean;
		standalone: boolean;
		updateAvailable: boolean;
		shellError: null | 'unavailable' | 'busy' | 'other-tabs';
		onClose(): void;
		onCheck(): void;
		onDownload(): void;
		onRepair(): void;
		onUse(): void;
		onOnline(): void;
		onReopen(): void;
		onCancel(): void;
		onRemove(): void;
		onPersistence(): void;
		onRefresh(): void;
		onInstall(): void;
		onAppUpdate(): void;
	}
	let { open, lang, model, startupFailed, actionFailed, installAvailable, standalone, updateAvailable, shellError,
		onClose, onCheck, onDownload, onRepair, onUse, onOnline, onReopen, onCancel, onRemove,
		onPersistence, onRefresh, onInstall, onAppUpdate }: Props = $props();
	let dialog = $state<HTMLDialogElement>();
	let confirmingDelete = $state(false);
	let strings = $derived(translations[lang]);
	let snapshot = $derived(model?.snapshot);
	let manifest = $derived(model?.offer?.available ? model.offer.manifest : snapshot?.active?.manifest ?? model?.offer?.manifest);
	let offeredReplacement = $derived(!!model?.offer?.available && !!snapshot?.active && model.offer.manifest.version !== snapshot.active.manifest.version);
	let awaitingCleanup = $derived(!!snapshot?.pendingRender || !!snapshot?.previous || !!snapshot?.pendingDeletionCount);
	let operation = $derived(snapshot?.operation ?? 'idle');
	let transferring = $derived(operation === 'downloading' || operation === 'verifying');
	let busy = $derived(model?.busy || transferring || operation === 'deleting');
	let unsupported = $derived(startupFailed || model?.status === 'unsupported');
	let additionalBytes = $derived(manifest ? manifest.totalBytes + Math.max(16 * 1024 ** 2, Math.ceil(manifest.totalBytes * .1)) : null);
	let availableBytes = $derived(model?.estimate?.quota !== undefined && model?.estimate?.usage !== undefined
		? Math.max(0, model.estimate.quota - model.estimate.usage) : null);
	let needsActivation = $derived(!!snapshot?.active && (snapshot.pendingRender || model?.displayedGeneration !== snapshot.active.id || model?.source !== 'offline'));
	let statusText = $derived.by(() => {
		if (unsupported) return strings.offlineUnsupported;
		if (!model || model.status === 'starting') return strings.offlineStarting;
		if (operation === 'downloading') return strings.offlineDownloading;
		if (operation === 'verifying') return strings.offlineVerifying;
		if (operation === 'deleting') return strings.offlineDeleting;
		if (operation === 'cleanup-deferred') return strings.offlineDeferred;
		if (snapshot?.availability === 'damaged') return strings.offlineDamaged;
		if (snapshot?.availability === 'absent') return strings.offlineAbsent;
		if (model.rendererError === 'context-lost') return strings.offlineContextLost;
		if (model.rendererError === 'offline-data') return strings.offlineDataError;
		if (snapshot?.pendingRender || (model.source === 'offline' && model.displayedGeneration !== snapshot?.active?.id)) return strings.offlineAwaitingRender;
		if (!model.usingOffline) return strings.offlineStored;
		if (model.rendererStatus !== 'ready') return strings.mapBackgroundLoading;
		if (!model.shellReady) return strings.offlineShellPending;
		return strings.offlineReady;
	});
	let errorText = $derived(model?.error === 'quota' ? strings.offlineQuotaError : model?.error === 'busy' ? strings.offlineBusyError : strings.offlineActionFailed);

	function bytes(value: number | null | undefined) {
		return value == null ? strings.offlineUnknownSpace : `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value / 1_000_000)} MB`;
	}
	function date(value: string) { return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)); }
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
	function closed() { confirmingDelete = false; onClose(); }
</script>

<dialog bind:this={dialog} aria-labelledby="offline-maps-title" data-testid="offline-maps-panel"
	data-version={snapshot?.active?.manifest.version ?? ''} data-generation={snapshot?.active?.id ?? ''}
	onclose={closed} oncancel={() => { confirmingDelete = false; }}>
	<header>
		<h2 id="offline-maps-title">{strings.offlineMaps}</h2>
		<button class="close" onclick={onClose} aria-label={strings.close}>×</button>
	</header>
	<p class="eyebrow">{strings.offlinePreview}</p>
	<h3>{strings.offlineRegion}</h3>
	<p>{strings.offlineIntro}</p>
	<p role="status" data-testid="offline-package-status" data-operation={operation} data-availability={snapshot?.availability ?? 'unknown'}>{statusText}</p>
	{#if (model?.error && model.error !== 'cancelled') || actionFailed || shellError === 'unavailable'}<p role="alert">{errorText}</p>{/if}
	{#if !unsupported && model && !model.shellReady}<p>{strings.offlineShellPending}</p>{/if}

	{#if offeredReplacement && snapshot?.active}
		<h3>{strings.offlineInstalledPackage}</h3>
		<dl>
			<dt>{strings.offlineDataDate}</dt><dd>{date(snapshot.active.manifest.dataDate)}</dd>
			<dt>{strings.offlinePackageSize}</dt><dd>{bytes(snapshot.active.manifest.totalBytes)}</dd>
		</dl>
	{/if}
	{#if manifest}
		<h3>{model?.offer?.available ? strings.offlineAvailablePackage : strings.offlineInstalledPackage}</h3>
		<dl>
			<dt>{strings.offlineDataDate}</dt><dd>{date(manifest.dataDate)}</dd>
			<dt>{strings.offlinePackageSize}</dt><dd>{bytes(manifest.totalBytes)}</dd>
			<dt>{strings.offlineFreeSpace}</dt><dd>{bytes(availableBytes)}</dd>
			<dt>{strings.offlineTemporarySpace}</dt><dd>{bytes(additionalBytes)}</dd>
			<dt>{strings.offlineBounds}</dt><dd>{manifest.bounds.join(', ')}</dd>
		</dl>
	{/if}
	{#if transferring}
		<div aria-busy="true">
			<progress aria-label={statusText} max={snapshot?.progress?.total ?? 1} value={operation === 'downloading' ? snapshot?.progress?.bytes ?? 0 : undefined}></progress>
			{#if snapshot?.progress}<p>{bytes(snapshot.progress.bytes)} / {bytes(snapshot.progress.total)}</p>{/if}
			<button onclick={onCancel}>{strings.offlineCancel}</button>
		</div>
	{/if}
	{#if model?.offer && !transferring}
		{#if model.offer.available && snapshot?.active}<p>{strings.offlineUpdateAvailable}</p>
		{:else if !model.offer.available}<p>{strings.offlineCurrent}</p>{/if}
	{/if}
	<div class="actions">
		<button onclick={onCheck} disabled={busy || unsupported || !model}>{strings.offlineCheck}</button>
		{#if snapshot?.availability === 'damaged'}
			<button onclick={onRepair} disabled={busy || !manifest || !model?.shellReady}>{strings.offlineRepair}</button>
		{:else if snapshot?.availability === 'absent' || model?.offer?.available}
			<button class="primary" onclick={onDownload} disabled={busy || awaitingCleanup || unsupported || !manifest || !model?.shellReady}>{snapshot?.active ? strings.offlineUpdate : strings.offlineDownload}</button>
		{/if}
		{#if snapshot?.availability === 'ready' && needsActivation}
			<button class="primary" onclick={onUse} disabled={busy || !model?.shellReady}>{strings.offlineUse}</button>
		{/if}
		{#if model?.rendererError === 'context-lost' || model?.rendererError === 'offline-data'}
			<button onclick={onReopen} disabled={busy}>{strings.offlineReopen}</button>
		{/if}
		{#if model?.source === 'offline'}<button onclick={onOnline} disabled={busy}>{strings.offlineOnline}</button>{/if}
		{#if snapshot?.active || snapshot?.pendingDeletionCount}
			<button onclick={() => { confirmingDelete = true; }} disabled={operation === 'deleting'}>{strings.offlineRemove}</button>
		{/if}
	</div>
	{#if confirmingDelete}
		<section class="confirmation" aria-label={strings.offlineRemove}>
			<p>{strings.offlineRemoveConfirm}</p>
			<p>{bytes(snapshot?.active?.manifest.totalBytes)}</p>
			<div class="actions">
				<button onclick={() => { confirmingDelete = false; onRemove(); }}>{strings.offlineConfirmRemove}</button>
				<button onclick={() => { confirmingDelete = false; }}>{strings.offlineCancel}</button>
			</div>
		</section>
	{/if}
	<section>
		<h3>{strings.offlinePersistence}</h3>
		<p data-testid="offline-persistence" data-persistence={snapshot?.persistence ?? 'unavailable'}>{snapshot?.persistence === 'granted' ? strings.offlinePersistenceGranted : snapshot?.persistence === 'not-granted' ? strings.offlinePersistenceDenied : strings.offlinePersistenceUnavailable}</p>
		<p>{strings.offlinePersistenceLimit}</p>
		<div class="actions">
			{#if snapshot?.persistence === 'not-granted'}<button onclick={onPersistence} disabled={busy}>{strings.offlinePersistenceRequest}</button>{/if}
			<button onclick={onRefresh} disabled={busy}>{strings.offlinePersistenceCheck}</button>
		</div>
		{#if standalone}<p>{strings.offlineInstalled}</p>
		{:else if installAvailable}<button onclick={onInstall}>{strings.offlineInstall}</button>
		{:else}<p>{strings.offlineInstallHelp}</p>{/if}
	</section>
	{#if updateAvailable}
		<section>
			<h3>{strings.offlineAppUpdate}</h3>
			{#if busy || shellError === 'busy' || shellError === 'other-tabs'}<p role="status">{strings.offlineAppUpdateBusy}</p>{/if}
			<button onclick={onAppUpdate} disabled={busy}>{strings.offlineApplyAppUpdate}</button>
		</section>
	{/if}
</dialog>

<style>
	dialog { width: min(32rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); padding: 1rem; border: 1px solid var(--color-border); border-radius: .75rem; background: var(--color-bg); color: var(--color-text); overflow-y: auto; }
	dialog::backdrop { background: var(--color-bg); opacity: .8; }
	header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
	h2 { margin: 0; font-size: 1.35rem; }
	h3 { margin: 1rem 0 .5rem; font-size: 1.1rem; }
	p { line-height: 1.45; margin: .65rem 0; }
	.eyebrow { color: var(--color-text-muted); font-size: .85rem; }
	section { border-top: 1px solid var(--color-border); margin-top: 1rem; padding-top: .5rem; }
	dl { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: .5rem 1rem; font-size: .9rem; }
	dt { color: var(--color-text-muted); } dd { margin: 0; overflow-wrap: anywhere; }
	button { min-height: 44px; padding: .5rem .75rem; border: 1px solid var(--color-border); border-radius: .4rem; background: var(--color-surface); color: var(--color-text); font: inherit; cursor: pointer; }
	button:hover { background: var(--color-surface-hover); }
	button:disabled { opacity: .55; cursor: default; }
	button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
	.close { min-width: 44px; font-size: 1.5rem; }
	.primary { border-color: var(--color-accent); }
	.actions { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .75rem; }
	progress { width: 100%; accent-color: var(--color-accent); }
	.confirmation { border: 1px solid var(--color-error); border-radius: .5rem; padding: .75rem; }
</style>
