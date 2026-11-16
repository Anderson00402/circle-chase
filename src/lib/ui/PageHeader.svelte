<script lang="ts">
	/** Page title, one line saying what the page is for, and optional actions on the right. */
	import type { Snippet } from 'svelte';
	interface Props {
		title: string;
		/** One sentence: what this page shows and why. */
		lead?: string;
		/** Small label above the title, e.g. "Results". */
		eyebrow?: string;
		actions?: Snippet;
		/** Extra content under the lead (badges, filters). */
		children?: Snippet;
	}
	let { title, lead, eyebrow, actions, children }: Props = $props();
</script>

<header class="ph">
	<div class="text">
		{#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
		<h1>{title}</h1>
		{#if lead}<p class="lead">{lead}</p>{/if}
		{#if children}<div class="extra">{@render children()}</div>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
	.ph {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-5);
		margin-bottom: var(--space-6);
		padding-bottom: var(--space-5);
		border-bottom: 1px solid var(--rule);
	}
	.text { min-width: 0; }
	.eyebrow { margin-bottom: var(--space-2); }
	h1 {
		font-size: var(--text-2xl);
		font-weight: 600;
	}
	.lead {
		max-width: 62ch;
		margin-top: var(--space-2);
		color: var(--ink-dim);
		font-size: var(--text-lg);
		line-height: 1.45;
	}
	.extra { margin-top: var(--space-3); }
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		flex-shrink: 0;
	}
	@media (max-width: 720px) {
		.ph { flex-direction: column; align-items: stretch; }
		h1 { font-size: var(--text-xl); }
		.lead { font-size: var(--text-md); }
	}
</style>
