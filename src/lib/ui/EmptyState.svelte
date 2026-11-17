<script lang="ts">
	/** Shown where data or content will appear. Say what is missing and how to get it. */
	import type { Snippet } from 'svelte';
	interface Props {
		title: string;
		/** Icon: an empty maze corner (default), a chart, a film strip, or a clipboard. */
		icon?: 'maze' | 'chart' | 'replay' | 'study';
		children?: Snippet;
		actions?: Snippet;
		compact?: boolean;
		/** The title's heading level: h1 when it is all the page has (a not-found page). */
		heading?: 'h1' | 'h2' | 'h3';
	}
	let { title, icon = 'maze', children, actions, compact = false, heading = 'h3' }: Props = $props();
</script>

<div class="empty" class:compact>
	<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
		<rect x="1" y="1" width="46" height="46" rx="12" fill="var(--surface-2)" stroke="var(--rule-strong)" />
		{#if icon === 'chart'}
			<path d="M13 34V24M21 34V16M29 34V27M37 34V20" stroke="var(--ink-faint)" stroke-width="3" stroke-linecap="round" />
		{:else if icon === 'replay'}
			<rect x="11" y="15" width="26" height="18" rx="3" fill="none" stroke="var(--ink-faint)" stroke-width="2.4" />
			<path d="M21.5 20v8l6.5-4z" fill="var(--accent)" />
		{:else if icon === 'study'}
			<rect x="14" y="11" width="20" height="26" rx="3" fill="none" stroke="var(--ink-faint)" stroke-width="2.4" />
			<path d="M19 19h10M19 24h10M19 29h6" stroke="var(--ink-faint)" stroke-width="2.4" stroke-linecap="round" />
		{:else}
			<path d="M12 36V18a6 6 0 0 1 6-6h18M20 36V24a4 4 0 0 1 4-4h12" fill="none" stroke="var(--ink-faint)" stroke-width="2.4" stroke-linecap="round" />
			<circle cx="31" cy="30" r="3" fill="var(--accent)" />
		{/if}
	</svg>
	<svelte:element this={heading} class="title">{title}</svelte:element>
	{#if children}<div class="text">{@render children()}</div>{/if}
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-8) var(--space-5);
		border: 1px dashed var(--rule-strong);
		border-radius: var(--radius-lg);
		text-align: center;
	}
	.compact { padding: var(--space-6) var(--space-4); }
	svg { margin-bottom: var(--space-2); }
	.title {
		font-size: var(--text-lg);
		font-weight: 700;
	}
	.text {
		max-width: 46ch;
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
</style>
