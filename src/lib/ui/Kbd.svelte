<script lang="ts">
	/** A keyboard key, e.g. <Kbd>Space</Kbd> or <Kbd>↑</Kbd>. */
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<kbd>{@render children()}</kbd>

<style>
	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.6em;
		height: 1.6em;
		padding: 0 0.4em;
		border: 1px solid var(--rule-strong);
		border-bottom-width: 2px;
		border-radius: 5px;
		background: var(--surface-2);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: 0.78em;
		font-weight: 600;
		line-height: 1;
		vertical-align: 0.1em;
	}
</style>
