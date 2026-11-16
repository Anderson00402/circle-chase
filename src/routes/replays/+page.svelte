<script lang="ts">
	// PLACEHOLDER: the replay browser and player go here. Use <Page width="full"> for the player view.
	import { Button, EmptyState, FREE_PLAY_HREF, Page, PageHeader } from '#lib/ui/index.ts';
</script>

<svelte:head><title>Replays · Circle Chase</title></svelte:head>

<Page width="wide">
	<PageHeader
		eyebrow="Close calls"
		title="Replays"
		lead="Watch the last seconds of a power-up again, with the exact cue the player saw."
	/>

	<p class="intro">
		This page will list saved moments, filterable by cue and outcome (caught, late catch, timely
		retreat), and play them back with pause, slow motion and frame stepping. A moment can also be
		redrawn with a different cue to compare.
	</p>

	<EmptyState title="No replays yet" icon="replay">
		A replay is saved for every power-up where the player was chasing near the end.
		{#snippet actions()}
			<Button variant="primary" href={FREE_PLAY_HREF}>Play a round</Button>
		{/snippet}
	</EmptyState>
</Page>

<style>
	.intro {
		max-width: 70ch;
		margin-bottom: var(--space-5);
		color: var(--ink-dim);
	}
</style>
