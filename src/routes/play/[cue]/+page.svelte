<script lang="ts">
	/**
	 * Free play of one cue, measured. `?mode=study` plays with the study settings (random power
	 * length, power dots grow back, endless lives) and records `mode: 'study'`.
	 */
	import { page } from '$app/state';
	import { cueById } from '#lib/game/cues/index.ts';
	import { STUDY_CONFIG } from '#lib/game/engine/game.ts';
	import TrackedGame from '#lib/telemetry/TrackedGame.svelte';

	const cue = $derived(cueById(page.params.cue ?? 'none'));
	const mode = $derived(page.url.searchParams.get('mode') === 'study' ? 'study' : 'arcade');
	const config = $derived(mode === 'study' ? { ...STUDY_CONFIG } : {});
</script>

<svelte:head><title>{cue.name} · Circle Chase</title></svelte:head>

<div class="play">
	{#key `${cue.id}:${mode}`}
		<TrackedGame {cue} {mode} {config} />
	{/key}
</div>

<style>
	.play { flex: 1; min-height: 0; padding: 16px; box-sizing: border-box; overflow: auto; }
</style>
