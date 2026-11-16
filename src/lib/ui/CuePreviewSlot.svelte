<script lang="ts">
	/**
	 * SLOT for a live cue preview thumbnail (to be built by the preview agent).
	 *
	 * Today it draws a placeholder: a dark board-shaped tile with the cue's code. To add the real
	 * preview, either pass it as children (<CuePreviewSlot {cue}><MyPreview {cue} /></CuePreviewSlot>)
	 * or replace the placeholder branch below. Keep the box: it has the board's aspect ratio
	 * (19 x 21 tiles) and fills its container's width, so the home grid and the cues gallery need
	 * no layout change. A preview should draw from game time, pause off-screen, and show a still
	 * frame under prefers-reduced-motion.
	 */
	import type { Snippet } from 'svelte';
	import type { Cue } from '#lib/game/types.ts';
	interface Props {
		cue: Pick<Cue, 'id' | 'code' | 'role'>;
		/** Width / height of the box. Defaults to the board's. */
		ratio?: number;
		children?: Snippet;
	}
	let { cue, ratio = 19 / 21, children }: Props = $props();
</script>

<div class="slot {cue.role}" style:aspect-ratio={ratio} data-cue-preview={cue.id}>
	{#if children}
		{@render children()}
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
		<span class="label">Preview coming</span>
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
