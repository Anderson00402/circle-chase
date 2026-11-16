<script lang="ts">
	/**
	 * A small "i" button that shows a definition on hover, focus or tap. Use it next to every metric
	 * name on data pages so the definitions from docs/STUDY.md are one hover away.
	 *   <InfoTip term="Caught rate">Caught trials divided by engaged trials.</InfoTip>
	 */
	import type { Snippet } from 'svelte';
	interface Props {
		/** The word being defined; shown in bold at the top and used as the button label. */
		term?: string;
		/** Which side of the button the popover opens towards. */
		align?: 'start' | 'end';
		children: Snippet;
	}
	let { term, align = 'start', children }: Props = $props();
	const id = $props.id();
	let hover = $state(false);
	let focus = $state(false);
	let pinned = $state(false);
	const open = $derived(hover || focus || pinned);
	let pop = $state<HTMLSpanElement>();
	// Nudge the popover back inside the viewport when it would stick out at a screen edge.
	let shift = $state(0);
	$effect(() => {
		if (!open || !pop) return;
		shift = 0;
		requestAnimationFrame(() => {
			if (!pop) return;
			const r = pop.getBoundingClientRect(), pad = 12;
			if (r.right > innerWidth - pad) shift = innerWidth - pad - r.right;
			else if (r.left < pad) shift = pad - r.left;
		});
	});
</script>

<span
	class="tip"
	role="presentation"
	onmouseenter={() => (hover = true)}
	onmouseleave={() => (hover = false)}
>
	<button
		type="button"
		aria-label={term ? `What is ${term.toLowerCase()}?` : 'More information'}
		aria-describedby={id}
		aria-expanded={open}
		onfocus={() => (focus = true)}
		onblur={() => {
			focus = false;
			pinned = false;
		}}
		onclick={() => (pinned = !pinned)}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				hover = focus = pinned = false;
			}
		}}
	>
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4" />
			<rect x="7.25" y="7" width="1.5" height="4.5" rx="0.75" fill="currentColor" />
			<circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
		</svg>
	</button>
	<span {id} bind:this={pop} role="tooltip" class="pop {align}" class:open style:translate="{shift}px 0">
		{#if term}<strong>{term}</strong>{/if}
		<span class="def">{@render children()}</span>
	</span>
</span>

<style>
	.tip {
		position: relative;
		display: inline-flex;
		vertical-align: middle;
	}
	button {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		margin: -4px 0;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--ink-faint);
		cursor: help;
	}
	button:hover,
	button[aria-expanded='true'] {
		color: var(--focus);
	}
	.pop {
		position: absolute;
		top: calc(100% + 8px);
		z-index: 50;
		width: max-content;
		max-width: min(300px, 80vw);
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: var(--surface-3);
		box-shadow: var(--shadow-pop);
		color: var(--ink);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 400;
		line-height: 1.45;
		letter-spacing: 0;
		text-transform: none;
		text-align: left;
		white-space: normal;
		/* Closed popovers take no space, so they never widen the page. */
		display: none;
	}
	.pop.start { left: -6px; }
	.pop.end { right: -6px; }
	.pop.open {
		display: block;
		animation: tip-in var(--dur) var(--ease);
	}
	@keyframes tip-in {
		from { opacity: 0; }
	}
	strong {
		display: block;
		margin-bottom: 2px;
		font-weight: 700;
	}
	.def {
		display: block;
		color: var(--ink-dim);
	}
</style>
