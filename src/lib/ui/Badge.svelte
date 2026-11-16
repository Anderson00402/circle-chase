<script lang="ts">
	/** Small status label. `sim` marks simulated (bot) data and must be used wherever bot data shows. */
	import type { Snippet } from 'svelte';
	export type BadgeTone = 'neutral' | 'accent' | 'good' | 'bad' | 'warn' | 'sim' | 'live';
	interface Props {
		tone?: BadgeTone;
		children: Snippet;
		title?: string;
	}
	let { tone = 'neutral', children, title }: Props = $props();
</script>

<span class="badge {tone}" {title}>
	{#if tone === 'live'}<span class="dot" aria-hidden="true"></span>{/if}
	{@render children()}
</span>

<style>
	.badge {
		--c: var(--ink-dim);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 22px;
		padding: 0 8px;
		border-radius: var(--radius-pill);
		border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
		background: color-mix(in srgb, var(--c) 12%, transparent);
		color: var(--c);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
		vertical-align: middle;
	}
	.accent { --c: var(--accent); }
	.good, .live { --c: var(--good); }
	.bad { --c: var(--bad); }
	.warn { --c: var(--warn); }
	.sim { --c: var(--sim); }
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		50% { opacity: 0.3; }
	}
</style>
