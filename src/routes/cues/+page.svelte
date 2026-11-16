<script lang="ts">
	/**
	 * The cue gallery: every condition as a live looping preview of the same moment of play, so a
	 * visitor can compare them all in a minute. "Look closer" opens a larger preview with a scrubber
	 * and the seconds left; `/cues#<cue-id>` opens it directly.
	 */
	import { onMount } from 'svelte';
	import type { Cue, CueChannel } from '#lib/game/types.ts';
	import CuePreview from '#lib/ui/CuePreview.svelte';
	import {
		Badge,
		Button,
		CueChip,
		CuePreviewSlot,
		Dialog,
		Page,
		PageHeader,
		cueListings,
		ROLE_LABEL,
		type CueListing
	} from '#lib/ui/index.ts';

	const all = cueListings();
	const ROLES: { role: CueListing['role']; text: string }[] = [
		{ role: 'reference', text: 'References: no signal at all, and the usual white blink' },
		{ role: 'baseline', text: 'Baseline: a draining bar with seconds' },
		{ role: 'idea', text: 'Ideas: ten new places to show the countdown' }
	];

	const CHANNEL: Record<CueChannel, string> = {
		hud: 'Beside the board',
		ghosts: 'On the ghosts',
		player: 'On the player',
		maze: 'In the maze',
		screen: 'Whole screen'
	};

	let open = $state(false);
	let current = $state<Cue | null>(null);

	function show(cue: Cue) {
		current = cue;
		open = true;
		history.replaceState(history.state, '', `#${cue.id}`);
	}
	function closed() {
		history.replaceState(history.state, '', location.pathname + location.search);
	}

	onMount(() => {
		const id = location.hash.slice(1);
		const hit = all.find((c) => c.id === id)?.cue;
		if (hit) show(hit);
	});
</script>

<svelte:head><title>Cues · Circle Chase</title></svelte:head>

<Page width="wide">
	<PageHeader
		eyebrow="Conditions"
		title="The cues"
		lead="Thirteen ways to show that a power-up is about to end. Every preview replays the same moment: a power dot, a chase, and the power running out with scared ghosts still close."
	/>

	<p class="how">
		All previews run on one clock, so they reach the end at the same time. Open one to scrub through
		it and see how many seconds were left at each moment. Previews are silent; some cues also use sound
		in the game.
	</p>

	<ul class="legend" aria-label="Roles">
		{#each ROLES as r (r.role)}<li class={r.role}><span aria-hidden="true"></span>{r.text}</li>{/each}
	</ul>

	<ul class="grid">
		{#each all as c (c.id)}
			<li class="card {c.role}" class:pending={!c.ready} id="card-{c.id}">
				<CuePreviewSlot cue={c} />
				<div class="body">
					<CueChip cue={c} wrap />
					<p class="tag">{c.tagline}</p>
					{#if c.cue}<p class="meta"><Badge>{CHANNEL[c.cue.channel]}</Badge></p>{/if}
				</div>
				<div class="actions">
					{#if c.cue}
						{@const cue = c.cue}
						<Button size="sm" onclick={() => show(cue)}>Look closer<span class="visually-hidden">: {c.name}</span></Button>
						<Button size="sm" variant="ghost" href="/play/{c.id}">Play<span class="visually-hidden"> with {c.name}</span></Button>
					{:else}
						<span class="soon">Being built</span>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
</Page>

<Dialog bind:open title={current ? `${current.code} · ${current.name}` : ''} width="lg" onclose={closed}>
	{#if current}
		<div class="detail">
			<div class="big">
				{#key current.id}<CuePreview cue={current} controls fps={60} />{/key}
			</div>
			<div class="text">
				<p class="lead">{current.tagline}</p>
				<p>{current.description}</p>
				<dl>
					<div><dt>Role</dt><dd>{ROLE_LABEL[current.role]}</dd></div>
					<div><dt>Where it shows</dt><dd>{CHANNEL[current.channel]}</dd></div>
					<div><dt>Uses sound</dt><dd>{current.sound ? 'Yes, when sound is on' : 'No'}</dd></div>
				</dl>
				<p class="note">The shaded part of the track is the power-up. Drag it to any moment; the readout shows the seconds that were left.</p>
			</div>
		</div>
	{/if}
	{#snippet actions()}
		{#if current}
			<Button variant="ghost" href="/dashboard">Results</Button>
			<Button variant="primary" href="/play/{current.id}">Play with this cue</Button>
		{/if}
	{/snippet}
</Dialog>

<style>
	.how { max-width: 70ch; color: var(--ink-dim); margin-bottom: var(--space-6); }
	.legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); margin: 0 0 var(--space-5); padding: 0; list-style: none; color: var(--ink-dim); font-size: var(--text-sm); }
	.legend li { display: inline-flex; align-items: center; gap: 6px; }
	.legend span { width: 10px; height: 10px; border-radius: 3px; background: var(--role-reference); }
	.legend .baseline span { background: var(--role-baseline); }
	.legend .idea span { background: var(--role-idea); }
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
	}
	.body { display: flex; flex-direction: column; gap: var(--space-2); flex: 1; padding: 0 var(--space-1); }
	.tag { color: var(--ink-dim); font-size: var(--text-sm); line-height: 1.45; }
	.actions { display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-1) var(--space-1); }
	.meta { margin-top: auto; padding-top: var(--space-1); }
	.soon { color: var(--ink-faint); font-size: var(--text-sm); }
	.pending :global(.slot) { opacity: 0.6; }

	.detail { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: var(--space-5); }
	.big { aspect-ratio: 19 / 23; min-height: 0; }
	.text { display: flex; flex-direction: column; gap: var(--space-3); color: var(--ink-dim); }
	.text .lead { color: var(--ink); font-size: var(--text-lg); }
	dl { display: grid; gap: var(--space-2); margin: 0; }
	dl div { display: flex; justify-content: space-between; gap: var(--space-3); border-bottom: 1px solid var(--rule); padding-bottom: var(--space-2); }
	dt { color: var(--ink-faint); }
	dd { margin: 0; color: var(--ink); }
	.note { font-size: var(--text-sm); color: var(--ink-faint); }
	@media (max-width: 640px) {
		.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
		.actions { flex-wrap: wrap; }
		.meta { display: none; }
		.detail { grid-template-columns: 1fr; }
		.big { width: min(100%, 320px); margin: 0 auto; }
	}
</style>
