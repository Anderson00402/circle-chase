<script lang="ts">
	/**
	 * After "End run": what this run measured (live from Convex), each trial with a link to its
	 * replay, and an optional, skippable card with the two 1-7 questions for the participant.
	 */
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import type { Cue } from '../game/types';
	import type { RecentTrial } from '../telemetry/client.svelte.ts';
	import { Button, CueChip, Kbd, Scale7 } from '#lib/ui/index.ts';
	import OutcomeBar from './OutcomeBar.svelte';
	import { getOutbox } from './outbox.svelte.ts';
	import { ORDER, TONE, WORDS, toneOf, wordsOf } from './outcomes';

	interface Props {
		cue: Cue;
		blockKey: string;
		label: string;
		/** Run number in the session (1-based). */
		number: number;
		recent: RecentTrial[];
		hideCase: boolean;
		next: Cue | null;
		onnext: () => void;
		onagain: () => void;
	}
	let { cue, blockKey, label, number, recent, hideCase, next, onnext, onagain }: Props = $props();

	const client = useConvexClient();
	const res = useQuery(api.runs.block, () => ({ blockKey }));
	const d = $derived(res.data);

	// Before the server has the rows (or offline), show what this page measured.
	const localOutcomes = $derived(recent.reduce<Record<string, number>>((m, t) => ((m[t.outcome] = (m[t.outcome] ?? 0) + 1), m), {}));
	const outcomes = $derived(d?.outcomes ?? localOutcomes);
	const trials = $derived(d?.trials ?? recent.length);

	let clarity = $state<number | null>(null);
	let distraction = $state<number | null>(null);
	let asked = $state<'open' | 'saved' | 'skipped'>('open');
	$effect(() => {
		// A rating already on the server (refresh of this view) counts as answered.
		if (d?.clarity != null && asked === 'open') { clarity = d.clarity; distraction = d.distraction; asked = 'saved'; }
	});
	function save() {
		if (clarity === null || distraction === null) return;
		getOutbox(client).send('rateBlock', { key: `${blockKey}:rating`, blockKey, clarity, distraction }, `rate:${blockKey}`);
		asked = 'saved';
	}

	const fmt = (x: number | null | undefined, unit = ' s') => (x === null || x === undefined ? '-' : `${x.toFixed(1)}${unit}`);
	const pct = (k: number, n: number) => (n ? `${Math.round((k / n) * 100)}%` : '-');
</script>

<div class="summary">
	<header>
		<p class="eyebrow">Run {number} done · {label || 'participant'}</p>
		<h1>
			{#if hideCase}Run complete{:else}<CueChip {cue} /> <span class="sr">Run complete</span>{/if}
		</h1>
	</header>

	<div class="grid">
		<section class="what" aria-labelledby="sum-title">
			<h2 id="sum-title">What was measured</h2>
			<dl class="stats">
				<div><dt>Power-ups</dt><dd class="num">{trials}</dd></div>
				<div><dt title="Power-ups where the player had to decide about the end: turned away or stayed on">Decisions (count)</dt><dd class="num">{d?.counted ?? '-'}</dd></div>
				<div><dt>Turned away in time</dt><dd class="num good">{d ? `${d.wellTimed}` : '-'} <small>{d ? pct(d.wellTimed, d.counted) : ''}</small></dd></div>
				<div><dt>Caught after the end</dt><dd class="num bad">{d ? `${d.caught}` : '-'} <small>{d ? pct(d.caught, d.counted) : ''}</small></dd></div>
				<div><dt>Replays saved</dt><dd class="num">{d?.clips ?? '-'}</dd></div>
			</dl>
			{#if trials > 0}
				<OutcomeBar {outcomes} height={8} />
				<ul class="mix">
					{#each ORDER.filter((o) => (outcomes[o] ?? 0) > 0) as o (o)}
						<li><span class="dot {TONE[o]}"></span><span class="num">{outcomes[o]}</span> {WORDS[o]}</li>
					{/each}
				</ul>
			{:else}
				<p class="empty">No power-up was finished in this run.</p>
			{/if}

			{#if d && d.rows.length}
				<div class="table-wrap">
					<table>
						<caption class="visually-hidden">Power-ups in this run</caption>
						<thead><tr><th scope="col">#</th><th scope="col" class="n">Power</th><th scope="col">What happened</th><th scope="col" class="n" title="Power left when the player turned away from the ghost (or ate it)">Turned away</th><th scope="col" class="n">Ghosts</th><th scope="col"><span class="visually-hidden">Replay</span></th></tr></thead>
						<tbody>
							{#each d.rows as t (t._id)}
								<tr class:dim={!t.counted}>
									<td class="num">{t.trialIndex + 1}</td>
									<td class="n num">{fmt(t.total)}</td>
									<td><span class="dot {toneOf(t.outcome)}"></span>{wordsOf(t.outcome)}{t.counted ? '' : ' (not counted)'}</td>
									<td class="n num">{t.turnLeft === null ? '-' : t.outcome === 'catch' ? `ate at ${t.turnLeft.toFixed(1)} s` : t.turnLeft >= 0 ? `${t.turnLeft.toFixed(1)} s left` : `${(-t.turnLeft).toFixed(1)} s late`}</td>
									<td class="n num">{t.eats}</td>
									<td>{#if t.clipId}<a href="/replays/{t._id}">Replay</a>{:else}<span class="dim">no clip</span>{/if}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if res.isLoading || (!d && recent.length)}
				<p class="empty">Waiting for the server...</p>
			{/if}
		</section>

		<section class="ask" aria-labelledby="ask-title">
			<h2 id="ask-title">Ask the participant <span class="opt">optional</span></h2>
			{#if asked === 'open'}
				<Scale7 question="I could tell when the power was about to run out." low="Not at all" high="Completely" bind:value={clarity} />
				<Scale7 question="The signal got in the way of playing." low="Not at all" high="Very much" bind:value={distraction} />
				<div class="ask-actions">
					<Button variant="quiet" disabled={clarity === null || distraction === null} onclick={save}>Save answers</Button>
					<Button variant="ghost" onclick={() => (asked = 'skipped')}>Skip</Button>
				</div>
			{:else if asked === 'saved'}
				<p class="done">Answers saved: clarity <span class="num">{clarity}</span>/7, got in the way <span class="num">{distraction}</span>/7.</p>
				<button class="link" onclick={() => (asked = 'open')}>Change</button>
			{:else}
				<p class="dim">Skipped. <button class="link" onclick={() => (asked = 'open')}>Ask after all</button></p>
			{/if}
		</section>
	</div>

	<footer class="go">
		{#if next}
			<Button variant="primary" size="lg" onclick={onnext}>
				Next case: {hideCase ? 'suggested' : `${next.code} · ${next.name}`} <span class="k"><Kbd>N</Kbd></span>
			</Button>
		{/if}
		<Button size="lg" onclick={onagain}>Play this case again</Button>
		<Button size="lg" variant="ghost" href="/">Back to console <span class="k"><Kbd>Esc</Kbd></span></Button>
	</footer>
</div>

<style>
	.summary { width: 100%; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); padding-bottom: var(--space-5); }
	.eyebrow { color: var(--accent); }
	h1 { display: flex; align-items: center; gap: var(--space-3); font-size: var(--text-2xl); font-weight: 600; margin-top: var(--space-1); }
	h1 :global(.chip) { font-size: var(--text-xl); }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
	.grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: var(--space-4); align-items: start; }
	section { padding: var(--space-4); border: 1px solid var(--rule); border-radius: var(--radius-lg); background: var(--surface); display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
	h2 { font-size: var(--text-md); font-weight: 650; }
	.opt { margin-left: 6px; color: var(--ink-faint); font-size: var(--text-xs); font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; }
	.stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--space-3); margin: 0; }
	.stats dt { color: var(--ink-dim); font-size: var(--text-xs); }
	.stats dd { margin: 2px 0 0; font-size: var(--text-xl); font-weight: 700; }
	.stats small { font-size: var(--text-xs); color: var(--ink-faint); font-weight: 500; }
	.good { color: var(--good); }
	.bad { color: var(--bad); }
	.mix { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px var(--space-4); font-size: var(--text-sm); color: var(--ink-dim); }
	.mix li { display: inline-flex; align-items: center; gap: 6px; }
	.mix .num { color: var(--ink); font-weight: 650; }
	.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--ink-faint); vertical-align: 1px; }
	.mix .dot { margin-right: 0; }
	.dot.good { background: var(--good); }
	.dot.warn { background: var(--warn); }
	.dot.bad { background: var(--bad); }
	.dot.catch { background: var(--scared); }
	.table-wrap { overflow: auto; max-height: 300px; }
	table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
	th, td { padding: 6px 8px; border-bottom: 1px solid var(--rule); text-align: left; white-space: nowrap; }
	thead th { position: sticky; top: 0; background: var(--surface); color: var(--ink-dim); font-size: var(--text-xs); font-weight: 600; }
	.n { text-align: right; }
	tr.dim td { color: var(--ink-faint); }
	.dim { color: var(--ink-faint); }
	.empty { color: var(--ink-dim); }
	.ask-actions { display: flex; gap: var(--space-2); }
	.done { color: var(--good); }
	.link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-size: var(--text-sm); text-decoration: underline; cursor: pointer; align-self: flex-start; }
	.go { display: flex; flex-wrap: wrap; gap: var(--space-3); }
	.k { margin-left: 6px; opacity: 0.75; }
	.k :global(kbd) { background: transparent; color: inherit; border-color: currentColor; }
	@media (max-width: 860px) {
		.grid { grid-template-columns: minmax(0, 1fr); }
		.stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.go :global(.btn) { flex: 1 1 100%; }
	}
</style>
