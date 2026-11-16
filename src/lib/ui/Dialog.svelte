<script lang="ts">
	/**
	 * Modal dialog on the native <dialog> element (focus trap, Escape to close, backdrop for free).
	 *   <Dialog bind:open title="Before you start">...{#snippet actions()}<Button>OK</Button>{/snippet}</Dialog>
	 */
	import type { Snippet } from 'svelte';
	interface Props {
		open: boolean;
		title: string;
		/** Close when the backdrop is clicked (off for questionnaires that must be answered). */
		dismissable?: boolean;
		width?: 'sm' | 'md' | 'lg';
		onclose?: () => void;
		children: Snippet;
		actions?: Snippet;
	}
	let { open = $bindable(), title, dismissable = true, width = 'md', onclose, children, actions }: Props = $props();
	let el: HTMLDialogElement;
	const id = $props.id();

	$effect(() => {
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	});
</script>

<dialog
	bind:this={el}
	class={width}
	aria-labelledby={id}
	onclose={() => {
		open = false;
		onclose?.();
	}}
	oncancel={(e) => {
		if (!dismissable) e.preventDefault();
	}}
	onclick={(e) => {
		if (dismissable && e.target === el) open = false;
	}}
>
	<div class="inner">
		<header>
			<h2 {id}>{title}</h2>
			{#if dismissable}
				<button type="button" class="x" aria-label="Close" onclick={() => (open = false)}>
					<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
				</button>
			{/if}
		</header>
		<div class="body">{@render children()}</div>
		{#if actions}<footer>{@render actions()}</footer>{/if}
	</div>
</dialog>

<style>
	dialog {
		width: min(520px, calc(100vw - 32px));
		max-height: calc(100dvh - 48px);
		padding: 0;
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-lg);
		background: var(--surface);
		color: var(--ink);
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
	}
	dialog.sm { width: min(400px, calc(100vw - 32px)); }
	dialog.lg { width: min(760px, calc(100vw - 32px)); }
	dialog::backdrop {
		background: rgba(4, 6, 14, 0.72);
		backdrop-filter: blur(3px);
	}
	dialog[open] { animation: rise 180ms var(--ease); }
	@keyframes rise {
		from { opacity: 0; transform: translateY(8px); }
	}
	.inner { padding: var(--space-5); }
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}
	h2 {
		font-family: var(--font-body);
		font-size: var(--text-xl);
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.x {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		margin: -4px -6px 0 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--ink-dim);
		cursor: pointer;
	}
	.x:hover { background: var(--surface-2); color: var(--ink); }
	.body { color: var(--ink-dim); }
	.body :global(p + p) { margin-top: var(--space-3); }
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}
</style>
