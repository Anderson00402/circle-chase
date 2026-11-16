<script lang="ts">
	/**
	 * Board-shaped box (19 x 21 tiles) for a cue thumbnail. Fills its container's width.
	 *
	 *   <CuePreviewSlot cue={listing} />                      live preview when the cue is registered
	 *   <CuePreviewSlot cue={listing} play="hover" />          still frame, animates on hover / focus
	 *   <CuePreviewSlot cue={listing}>...</CuePreviewSlot>     anything else inside the box
	 *
	 * A cue whose file is not written yet (no `cue.cue` and not a full Cue) shows a placeholder.
	 * Hover is detected on the closest `[data-preview-host]` ancestor (the card), or the box itself.
	 */
	import type { Snippet } from 'svelte';
	import type { Cue } from '#lib/game/types.ts';
	import CuePreview from './CuePreview.svelte';
	interface Props {
		/** A listing (`cueListings()`, with `cue` when registered) or a registered Cue. */
		cue: Pick<Cue, 'id' | 'code' | 'role'> & { cue?: Cue };
		/** Width / height of the box. Defaults to the board's. */
		ratio?: number;
		play?: 'loop' | 'hover' | 'still';
		fps?: number;
		children?: Snippet;
	}
	let { cue, ratio = 19 / 21, play = 'loop', fps, children }: Props = $props();
	const live = $derived<Cue | null>(cue.cue ?? ('tagline' in cue && 'channel' in cue ? (cue as Cue) : null));
</script>

<div class="slot {cue.role}" style:aspect-ratio={ratio} data-cue-preview={cue.id}>
	{#if children}
		{@render children()}
	{:else if live}
		<CuePreview cue={live} {play} {fps} />
	{:else}
		<svg class="maze" viewBox="0 0 76 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
			<path
				d="M6 6h64v72H6zM16 16h14v8H16zM46 16h14v8H46zM16 34h8v16h-8zM52 34h8v16h-8zM32 34h12v10H32zM16 60h18v8H16zM42 60h18v8H42z"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linejoin="round"
			/>
		</svg>
		<span class="code num" aria-hidden="true">{cue.code}</span>
		<span class="label">Being built</span>
	{/if}
</div>

<style>
	.slot {
		--c: var(--role-reference);
		position: relative;
		display: grid;
		place-items: center;
		width: 100%;
		overflow: hidden;
		border-radius: var(--radius-md);
		background:
			radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--c) 10%, transparent), transparent 70%),
			#05070f;
		border: 1px solid var(--rule);
	}
	.baseline { --c: var(--role-baseline); }
	.idea { --c: var(--role-idea); }
	.maze {
		position: absolute;
		inset: 10%;
		width: 80%;
		height: 80%;
		color: color-mix(in srgb, var(--c) 22%, transparent);
	}
	.code {
		position: relative;
		color: color-mix(in srgb, var(--c) 70%, transparent);
		font-size: 2rem;
		font-weight: 700;
	}
	.label {
		position: absolute;
		bottom: 8px;
		left: 0;
		right: 0;
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-align: center;
		text-transform: uppercase;
	}
</style>
