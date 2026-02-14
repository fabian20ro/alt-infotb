<script lang="ts">
	interface Props {
		onRefresh: () => void;
		loading?: boolean;
		autoRefreshEnabled?: boolean;
		onToggleAutoRefresh: () => void;
	}

	let { onRefresh, loading = false, autoRefreshEnabled = false, onToggleAutoRefresh }: Props =
		$props();
</script>

<div class="refresh-controls">
	<button class="refresh-btn" onclick={onRefresh} disabled={loading} aria-label="Reîmprospătare">
		<svg
			class="refresh-icon"
			class:spinning={loading}
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<polyline points="23 4 23 10 17 10" />
			<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
		</svg>
	</button>

	<label class="auto-refresh">
		<input type="checkbox" checked={autoRefreshEnabled} onchange={onToggleAutoRefresh} />
		<span>auto-refresh 30s</span>
	</label>
</div>

<style>
	.refresh-controls {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.refresh-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.refresh-btn:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}

	.refresh-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.refresh-icon {
		transition: transform 0.3s;
	}

	.spinning {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.auto-refresh {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
		cursor: pointer;
		user-select: none;
	}

	.auto-refresh input[type='checkbox'] {
		accent-color: var(--color-accent);
	}
</style>
