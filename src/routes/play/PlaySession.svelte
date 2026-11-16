<script lang="ts">
	/**
	 * One measured free-play block: the board and, beside it, the live measurement panel. Remount
	 * (with `{#key}`) to start a new block when the cue, rules or difficulty change.
	 */
	import { onDestroy } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import Game from '#lib/game/Game.svelte';
	import { STUDY_CONFIG } from '#lib/game/engine/game.ts';
	import type { Cue, Difficulty, GameConfig } from '#lib/game/types.ts';
	import { createTelemetry, type Mode } from '#lib/telemetry/client.svelte.ts';
	import LivePanel from '#lib/telemetry/LivePanel.svelte';

	interface Props {
		cue: Cue;
		mode: Mode;
		difficulty: Difficulty;
		panelOpen: boolean;
		showTime: boolean;
	}
	let { cue, mode, difficulty, panelOpen, showTime = $bindable() }: Props = $props();

	// The study settings without their fixed seed: every game gets a fresh one, so the sequence of
	// power lengths cannot be learned.
	const { seed: _seed, ...studyRules } = STUDY_CONFIG;
	// svelte-ignore state_referenced_locally
	const config: Partial<GameConfig> = mode === 'study' ? { ...studyRules, difficulty } : { difficulty };

	let sound = $state<boolean | undefined>(undefined);
	// svelte-ignore state_referenced_locally
	const tel = createTelemetry(useConvexClient(), { cue: cue.id, mode, difficulty, sound: () => sound !== false });
	if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ccTelemetry = tel;

	onDestroy(() => {
		tel.endBlock(0);
		tel.destroy();
	});
</script>

<div class="session" class:with-panel={panelOpen}>
	<div class="board">
		<Game {cue} {config} bind:sound onframe={tel.onFrame} onstart={tel.onStart} maxTile={34} />
	</div>
	{#if panelOpen}
		<div class="side" id="live-panel">
			<LivePanel live={tel.live} cue={cue.id} cueName={cue.name} bind:showTime />
		</div>
	{/if}
</div>

<style>
	.session {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		width: 100%;
		max-width: 1240px;
		margin: 0 auto;
		align-items: start;
	}
	.session.with-panel { grid-template-columns: minmax(0, 1fr) 300px; }
	.board { min-width: 0; }
	@media (max-width: 900px) {
		.session.with-panel { grid-template-columns: minmax(0, 1fr); }
		.side { max-width: 560px; width: 100%; margin: 0 auto; }
	}
</style>
