<script lang="ts">
	/** A titled surface. Use for each chart, table or form block on data pages. */
	import type { Snippet } from 'svelte';
	interface Props {
		title?: string;
		/** One line under the title, e.g. "Engaged trials only, humans". */
		sub?: string;
		/** Heading level for the title, to keep the page outline right. */
		level?: 2 | 3;
		/** Remove inner padding (for edge-to-edge tables and charts). */
		flush?: boolean;
		/** Buttons, tips or filters shown at the right of the title. */
		actions?: Snippet;
		children: Snippet;
		class?: string;
	}
	let { title, sub, level = 2, flush = false, actions, children, class: cls = '' }: Props = $props();
</script>

<section class="panel {cls}" class:flush>
	{#if title || actions}
		<header>
			<div class="titles">
				{#if title}<svelte:element this={'h' + level} class="title">{title}</svelte:element>{/if}
				{#if sub}<p class="sub">{sub}</p>{/if}
			</div>
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class="body">{@render children()}</div>
</section>

<style>
	.panel {
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		min-width: 0;
	}
	header {
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-3) var(--space-4);
		padding: var(--space-4) var(--space-5) 0;
	}
	.title {
		font-family: var(--font-body);
		font-size: var(--text-md);
		font-weight: 700;
		letter-spacing: 0;
	}
	.sub {
		margin-top: 2px;
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		max-width: 100%;
	}
	.body {
		padding: var(--space-4) var(--space-5) var(--space-5);
	}
	.flush .body {
		padding: var(--space-3) 0 0;
	}
	@media (max-width: 520px) {
		header { padding: var(--space-4) var(--space-4) 0; }
		.body { padding: var(--space-3) var(--space-4) var(--space-4); }
	}
</style>
