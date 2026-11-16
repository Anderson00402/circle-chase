<script lang="ts">
	/**
	 * Hover details for a chart. Place inside a `position: relative` chart box and give it the pointer
	 * position in that box; it opens above-right of the point and flips to stay inside the box.
	 *   {#if hover}<Tooltip x={hover.x} y={hover.y} width={w}>…</Tooltip>{/if}
	 */
	import type { Snippet } from 'svelte';
	interface Props {
		x: number;
		y: number;
		/** Width of the chart box, to flip at the right edge. */
		width: number;
		children: Snippet;
	}
	let { x, y, width, children }: Props = $props();
	let w = $state(0);
	let h = $state(0);
	const left = $derived(x + 14 + w > width ? Math.max(0, x - 14 - w) : x + 14);
	const top = $derived(Math.max(-8, y - h - 10));
</script>

<div class="tip" role="tooltip" bind:clientWidth={w} bind:clientHeight={h} style:left="{left}px" style:top="{top}px">
	{@render children()}
</div>

<style>
	.tip {
		position: absolute;
		z-index: 20;
		pointer-events: none;
		width: max-content;
		max-width: min(280px, 80vw);
		padding: 8px 10px;
		border-radius: var(--radius-md);
		background: var(--surface-3);
		box-shadow: var(--shadow-pop);
		color: var(--ink);
		font-size: var(--text-sm);
		line-height: 1.4;
	}
	.tip :global(.t-title) {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 2px;
		font-weight: 700;
	}
	.tip :global(.t-row) {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		color: var(--ink-dim);
	}
	.tip :global(.t-row b) {
		color: var(--ink);
		font-family: var(--font-mono);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.tip :global(.t-note) {
		margin-top: 4px;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
</style>
