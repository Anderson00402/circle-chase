<script lang="ts">
	/**
	 * Width and padding for a page's content. Every page renders inside one of these.
	 * narrow (760 px): reading, forms, the study flow. wide (1200 px): home, galleries, dashboard.
	 * full: edge to edge and fills the height under the top bar, for the game board and replays.
	 */
	import type { Snippet } from 'svelte';
	interface Props {
		width?: 'narrow' | 'wide' | 'full';
		children: Snippet;
		class?: string;
	}
	let { width = 'wide', children, class: cls = '' }: Props = $props();
</script>

<div class="page {width} {cls}">{@render children()}</div>

<style>
	.page {
		width: 100%;
		margin: 0 auto;
		padding: var(--space-6) var(--gutter) var(--space-8);
	}
	.narrow { max-width: calc(var(--page-narrow) + 2 * var(--gutter)); }
	.wide { max-width: calc(var(--page-wide) + 2 * var(--gutter)); }
	.full {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		padding: var(--space-3) var(--space-4);
	}
	@media (max-width: 520px) {
		.page:not(.full) { padding-top: var(--space-5); }
	}
</style>
