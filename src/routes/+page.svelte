<script lang="ts">
	import { CUES } from '#lib/game/cues/index.ts';
</script>

<main style="padding: 24px">
	<h1>Circle Chase</h1>
	<ul>
		{#each CUES as cue (cue.id)}
			<li><a href="/play/{cue.id}" style="color: inherit">{cue.index}. {cue.name}</a> — {cue.tagline}</li>
		{/each}
	</ul>
</main>
