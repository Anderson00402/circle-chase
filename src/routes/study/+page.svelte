<script lang="ts">
	// PLACEHOLDER: the study flow (consent, blocks per cue, questionnaire, end) goes here.
	import { Button, Dialog, EmptyState, Page, PageHeader, Panel, Scale7 } from '#lib/ui/index.ts';

	let about = $state(false);
	// Preview of the after-block question, so the scale can be tried before the flow exists.
	let clarity = $state<number | null>(null);
</script>

<svelte:head><title>Study · Circle Chase</title></svelte:head>

<Page width="narrow">
	<PageHeader
		eyebrow="Study"
		title="Take the study"
		lead="Play a short round with each countdown signal, then say how clear it was. About 15 minutes, no sign-up."
	>
		{#snippet actions()}
			<Button variant="quiet" onclick={() => (about = true)}>What happens</Button>
		{/snippet}
	</PageHeader>

	<p class="intro">
		This page will guide you through the study: a quick consent screen, one 90 second round per cue in
		a shuffled order, two questions after each round, and a final pick of the clearest and least clear
		signal. Power-ups last a random 4 to 8 seconds, so the cue is the only way to know when they end.
	</p>

	<EmptyState title="The study is being set up" icon="study">
		Until then, you can try any cue in free play.
		{#snippet actions()}
			<Button href="/cues">Browse the cues</Button>
		{/snippet}
	</EmptyState>

	<div class="preview">
	<Panel title="Preview: the question after each round" sub="Nothing is saved from this preview.">
		<Scale7
			question="I could tell when the power was about to run out."
			low="Not at all"
			high="Completely"
			bind:value={clarity}
		/>
	</Panel>
	</div>
</Page>

<Dialog bind:open={about} title="What happens in the study">
	<p>You play one short round for each of the thirteen signals. Lives are unlimited, so a mistake never ends the session.</p>
	<p>We record anonymous gameplay only: positions, timings and your answers. Nothing identifies you, and the data stays on this machine.</p>
	{#snippet actions()}
		<Button variant="primary" onclick={() => (about = false)}>Got it</Button>
	{/snippet}
</Dialog>

<style>
	.intro {
		margin-bottom: var(--space-5);
		color: var(--ink-dim);
	}
	.preview {
		margin-top: var(--space-5);
	}
</style>
