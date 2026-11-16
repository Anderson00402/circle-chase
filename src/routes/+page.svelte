<script lang="ts">
	import {
		Badge,
		Button,
		CueChip,
		CuePreviewSlot,
		FREE_PLAY_HREF,
		Kbd,
		Page,
		Stat,
		cueListings,
		ROLE_LABEL
	} from '#lib/ui/index.ts';
	import HeroArt from '#lib/ui/HeroArt.svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';

	const listings = cueListings();
	const ready = listings.filter((c) => c.ready).length;

	const STEPS = [
		{ title: 'Play', text: 'Clear the maze as usual. Eat a power dot and the chasers turn scared for a few seconds.' },
		{ title: 'Measure', text: 'Every power-up is one trial: did you chase to the end, get out in time, or get caught?' },
		{ title: 'Compare', text: 'The same game runs with thirteen different countdown signals, so trials can be compared cue by cue.' },
		{ title: 'Replay', text: 'Close calls are saved and can be watched again, frame by frame, with the cue the player saw.' }
	];

	// Live strip: totals of human play, straight from Convex (updates as trials arrive). `now` moves
	// every 10 s so "playing now" also drops back when people leave.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 10_000);
		return () => clearInterval(id);
	});
	const counters = useQuery(api.live.counters, () => ({ source: 'human' as const, now: Math.floor(now / 10_000) * 10_000 }));
	const live = $derived({
		trials: counters.data?.trials ?? null,
		participants: counters.data?.participants ?? null,
		playing: counters.data?.nowPlaying ?? null
	});
	const fmt = (n: number | null) => (n === null ? null : n.toLocaleString('en-US'));
</script>

<svelte:head>
	<title>Circle Chase · Which countdown works?</title>
</svelte:head>

<Page width="wide">
	<section class="hero">
		<div class="copy">
			<p class="eyebrow">A maze-chase game that is also an experiment</p>
			<h1>When the power is about to run out, which signal tells you best?</h1>
			<p class="lead">
				Circle Chase plays like a classic maze chase. Behind the scenes it tests thirteen ways of showing
				how much power-up time is left, and measures every power-up to see which one players actually
				read in time.
			</p>
			<div class="actions">
				<Button variant="primary" size="lg" href="/study">Take the study</Button>
				<Button size="lg" href={FREE_PLAY_HREF}>Free play</Button>
				<Button size="lg" variant="ghost" href="/dashboard">See the data →</Button>
			</div>
			<p class="note">
				The study takes about 8 minutes (or 20 for the full version). Use <Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>→</Kbd> or
				<Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd> to move.
			</p>
		</div>
		<div class="art">
			<HeroArt />
		</div>
	</section>

	<section class="live" aria-labelledby="live-title">
		<div class="live-head">
			<h2 id="live-title" class="eyebrow">So far</h2>
			{#if counters.error}
				<Badge tone="warn">Offline</Badge>
			{:else if live.trials === null}
				<Badge>Connecting</Badge>
			{:else}
				<Badge tone="live">Live</Badge>
			{/if}
		</div>
		<div class="live-stats">
			<Stat
				label="Power-ups measured"
				value={fmt(live.trials)}
				info="Each power-up a person plays is one trial: from eating the power dot until 3 seconds after it ends."
				sub="human players only"
			/>
			<Stat label="Participants" value={fmt(live.participants)} sub="anonymous" />
			<Stat label="Playing now" value={fmt(live.playing)} tone="accent" sub="open game pages" />
		</div>
	</section>

	<section class="how" aria-labelledby="how-title">
		<h2 id="how-title">How it works</h2>
		<ol>
			{#each STEPS as s, i (s.title)}
				<li>
					<span class="step num">{String(i + 1).padStart(2, '0')}</span>
					<h3>{s.title}</h3>
					<p>{s.text}</p>
				</li>
			{/each}
		</ol>
	</section>

	<section class="conditions" aria-labelledby="cond-title">
		<div class="cond-head">
			<div>
				<h2 id="cond-title">The thirteen conditions</h2>
				<p class="sub">
					Each shows one signal only. Two references, a timer bar as the baseline, and ten new ideas.
					<span class="num">{ready}</span> of <span class="num">{listings.length}</span> are playable so far.
				</p>
			</div>
			<ul class="legend" aria-label="Roles">
				{#each Object.entries(ROLE_LABEL) as [role, label] (role)}
					<li class={role}><span aria-hidden="true"></span>{label}</li>
				{/each}
			</ul>
		</div>

		<ul class="grid">
			{#each listings as c (c.id)}
				<li class="card" class:pending={!c.ready} data-preview-host>
					<CuePreviewSlot cue={c} play="hover" />
					<div class="card-body">
						<CueChip cue={c} wrap />
						<p class="tag">{c.tagline}</p>
					</div>
					{#if c.ready}
						<a class="play" href="/play/{c.id}">Play with this cue<span class="visually-hidden">: {c.name}</span></a>
					{:else}
						<span class="soon">Coming soon</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
</Page>

<style>
	/* Hero */
	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		align-items: center;
		gap: var(--space-7);
		padding: var(--space-6) 0 var(--space-7);
	}
	.eyebrow {
		color: var(--accent);
	}
	h1 {
		margin-top: var(--space-3);
		font-size: var(--text-3xl);
		font-weight: 600;
		line-height: 1.08;
		letter-spacing: -0.02em;
	}
	.lead {
		max-width: 56ch;
		margin-top: var(--space-4);
		color: var(--ink-dim);
		font-size: var(--text-lg);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-6);
	}
	.note {
		margin-top: var(--space-4);
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}
	.note :global(kbd) {
		margin-right: 2px;
	}

	/* Live strip */
	.live {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		padding: var(--space-4) var(--space-5);
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
	}
	.live-head {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding-right: var(--space-6);
		border-right: 1px solid var(--rule);
	}
	.live-head h2 {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--ink-dim);
	}
	.live-stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-5);
		flex: 1;
	}

	/* How it works */
	section.how,
	section.conditions {
		margin-top: var(--space-8);
	}
	section > h2,
	.cond-head h2 {
		font-size: var(--text-xl);
		font-weight: 600;
	}
	.how ol {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-5);
		margin: var(--space-5) 0 0;
		padding: 0;
		list-style: none;
		counter-reset: step;
	}
	.how li {
		position: relative;
		padding-top: var(--space-4);
		border-top: 2px solid var(--rule);
	}
	.how li:first-child {
		border-top-color: var(--accent);
	}
	.step {
		color: var(--accent);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.how h3 {
		margin-top: var(--space-1);
		font-size: var(--text-lg);
	}
	.how p {
		margin-top: var(--space-2);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}

	/* Conditions */
	.cond-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.sub {
		max-width: 64ch;
		margin-top: var(--space-2);
		color: var(--ink-dim);
	}
	.legend {
		display: flex;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.legend span {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: var(--role-reference);
	}
	.legend .baseline span {
		background: var(--role-baseline);
	}
	.legend .idea span {
		background: var(--role-idea);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: var(--space-4);
		margin: var(--space-5) 0 0;
		padding: 0;
		list-style: none;
	}
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
	}
	.card:not(.pending):hover {
		border-color: var(--rule-strong);
		transform: translateY(-2px);
	}
	.card:has(.play:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.card-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex: 1;
		padding: 0 var(--space-1);
	}
	.tag {
		color: var(--ink-dim);
		font-size: var(--text-sm);
		line-height: 1.45;
	}
	.play {
		padding: 0 var(--space-1) var(--space-1);
		font-size: var(--text-sm);
		font-weight: 650;
		text-decoration: none;
	}
	/* The whole card is the link target */
	.play::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}
	.play:focus-visible {
		outline: none;
	}
	.soon {
		padding: 0 var(--space-1) var(--space-1);
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}
	.pending :global(.slot) {
		opacity: 0.6;
	}

	@media (max-width: 960px) {
		.hero {
			grid-template-columns: 1fr;
			gap: var(--space-6);
		}
		.art {
			max-width: 520px;
		}
		.how ol {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 640px) {
		.hero {
			padding-top: var(--space-2);
		}
		.art {
			display: none;
		}
		.actions :global(.btn) {
			flex: 1 1 auto;
		}
		.live {
			flex-direction: column;
			align-items: stretch;
			gap: var(--space-4);
		}
		.live-head {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			padding: 0 0 var(--space-3);
			border-right: 0;
			border-bottom: 1px solid var(--rule);
		}
		.live-stats {
			gap: var(--space-3);
		}
		.live-stats :global(.value) {
			font-size: 1.5rem;
		}
		.how ol {
			grid-template-columns: 1fr;
		}
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: var(--space-3);
		}
	}
</style>
