<script lang="ts">
	import { page } from '$app/state';
	import Game from '#lib/game/Game.svelte';
	import { cueById } from '#lib/game/cues/index.ts';

	const cue = $derived(cueById(page.params.cue));
</script>

<main style="padding: 16px">
	{#key cue.id}
		<Game {cue} />
	{/key}
</main>
