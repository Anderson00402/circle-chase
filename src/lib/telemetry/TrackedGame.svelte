<script lang="ts">
	/**
	 * The game with telemetry attached: every power-up is measured and stored. One instance is one
	 * block (one cue played); wrap it in `{#key cue.id}` so a new cue opens a new block.
	 *
	 *   <TrackedGame {cue} mode="study" config={STUDY_CONFIG} />
	 */
	import { onDestroy } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import Game from '../game/Game.svelte';
	import type { Cue, GameConfig } from '../game/types';
	import { createTelemetry, type Mode, type Source } from './client.svelte.ts';
	import LivePanel from './LivePanel.svelte';

	interface Props {
		cue: Cue;
		mode: Mode;
		config?: Partial<GameConfig>;
		source?: Source;
		/** Show the measurement panel beside the board. */
		panel?: boolean;
	}
	let { cue, mode, config = {}, source, panel = true }: Props = $props();

	let sound = $state<boolean | undefined>(undefined);
	// Created once per block; props are read at creation on purpose.
	// svelte-ignore state_referenced_locally
	const tel = createTelemetry(useConvexClient(), {
		cue: cue.id, mode, source, difficulty: config.difficulty ?? 'normal', sound: () => sound !== false
	});
	if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ccTelemetry = tel;

	onDestroy(() => {
		tel.endBlock(0);
		tel.destroy();
	});
</script>

<div class="tracked">
	<Game {cue} {config} bind:sound onframe={tel.onFrame} onstart={tel.onStart} />
	{#if panel}<LivePanel live={tel.live} cue={cue.id} />{/if}
</div>

<style>
	.tracked { display: flex; gap: 16px; align-items: flex-start; justify-content: center; flex-wrap: wrap; min-height: 0; }
	.tracked > :global(:first-child) { flex: 1 1 420px; min-width: 0; }
</style>
