<script lang="ts">
	/**
	 * The end-of-run summary (/play/<case>?done=<run>). In participant view (on whenever a run
	 * starts) the participant sees only a thank-you and the two 1-7 questions: no outcome, so there is
	 * no feedback between cases. The researcher's view (V) adds what this run measured (live from
	 * Convex), each trial with a link to its replay and, when it does not count, why. An answer not yet saved is kept
	 * as a draft on this machine, so leaving for a replay and coming back does not lose it.
	 */
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import type { Cue } from '../game/types';
	import type { Mode, RecentTrial } from '../telemetry/client.svelte.ts';
	import { Button, CueChip, Kbd, Scale7 } from '#lib/ui/index.ts';
	import OutcomeBar from './OutcomeBar.svelte';
	import { getOutbox } from './outbox.svelte.ts';
	import { MODE_LABEL, OUTCOME_ORDER, outcomeColor, outcomeLabel, secs, turnWords } from '../outcomes';
	import { replayHref } from '../replay/list';
	import { slow } from '../ui/connection.svelte.ts';

	interface Props {
		cue: Cue;
		rules: Mode;
		blockKey: string;
		/** The label on this machine; the run's own label from the server wins when it has one. */
		label: string;
		/** Run number in the session (1-based), when this machine knows it. */
		number: number | null;
		/** What the play page measured, shown until the server has the rows. */
		recent: RecentTrial[];
		/** Decisions the play page counted in this run, shown until the server has the rows. */
		decisions?: number | null;
		hideCase: boolean;
		next: Cue | null;
		onnext: () => void;
		onagain: () => void;
	}
	let { cue, rules, blockKey, label, number, recent, decisions = null, hideCase, next, onnext, onagain }: Props = $props();

	const client = useConvexClient();
	const res = useQuery(api.runs.block, () => ({ blockKey }));
	const d = $derived(res.data);
	const waiting = slow(() => res.isLoading);

	// Before the server has the rows (or offline), show what this page measured.
	const localOutcomes = $derived(recent.reduce<Record<string, number>>((m, t) => ((m[t.outcome] = (m[t.outcome] ?? 0) + 1), m), {}));
	const outcomes = $derived(d?.outcomes ?? localOutcomes);
	const trials = $derived(d?.trials ?? recent.length);
	/** Before the server answers: the decisions this page counted (passed in by the play page). */
	const localDecisions = $derived(decisions ?? null);
	const runNo = $derived(number ?? (d ? d.orderIndex + 1 : null));
	const who = $derived(d?.label ?? label ?? '');

	// ----- the questionnaire, with a draft kept until it is saved or skipped -----
	interface Draft { clarity: number | null; distraction: number | null; asked: 'open' | 'saved' | 'skipped' }
	// The summary is mounted once per run ({#key} on the play page), so the key never changes.
	// svelte-ignore state_referenced_locally
	const DRAFT = `cc.run.rating.${blockKey}`;
	function readDraft(): Draft {
		try { return { clarity: null, distraction: null, asked: 'open', ...JSON.parse(localStorage.getItem(DRAFT) ?? '{}') }; }
		catch { return { clarity: null, distraction: null, asked: 'open' }; }
	}
	const first = readDraft();
	let clarity = $state<number | null>(first.clarity);
	let distraction = $state<number | null>(first.distraction);
	let asked = $state<Draft['asked']>(first.asked);
	$effect(() => {
		const draft: Draft = { clarity, distraction, asked };
		try {
			if (draft.clarity === null && draft.distraction === null && draft.asked === 'open') localStorage.removeItem(DRAFT);
			else localStorage.setItem(DRAFT, JSON.stringify(draft));
		} catch { /* storage blocked: the draft lives as long as the page */ }
	});
	$effect(() => {
		// A rating already on the server counts as answered.
		if (d?.clarity != null && asked === 'open' && clarity === null && distraction === null) {
			clarity = d.clarity; distraction = d.distraction; asked = 'saved';
		}
	});
	function save() {
		if (clarity === null || distraction === null) return;
		getOutbox(client).send('rateBlock', { key: `${blockKey}:rating`, blockKey, clarity, distraction }, `rate:${blockKey}`);
		asked = 'saved';
	}

	/** "1 of 3 · 33%": every share with its denominator. */
	const share = (k: number, n: number) => (n ? `of ${n} · ${Math.round((k / n) * 100)}%` : 'of 0');
	const notCounted = $derived(d ? d.rows.filter((r) => !r.counted) : []);
	/**
	 * The reasons rows do not count, each once with how many it covers (numbered footnotes), so a run
	 * of eats does not repeat the same sentence under every row and push "Next case" off the screen.
	 */
	const reasons = $derived.by(() => {
		const list: { text: string; n: number }[] = [];
		for (const r of d?.rows ?? []) {
			if (!r.reason) continue;
			const hit = list.find((x) => x.text === r.reason);
			if (hit) hit.n++;
			else list.push({ text: r.reason, n: 1 });
		}
		return list;
	});
	const reasonNo = (reason: string | null | undefined) => (reason ? reasons.findIndex((x) => x.text === reason) + 1 : 0);
	const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
</script>

<div class="summary">
	<header>
		<p class="eyebrow">Run {runNo ?? ''} done{who ? ` · ${who}` : ''}{rules === 'arcade' ? ` · ${MODE_LABEL.arcade}` : ''}</p>
		<h1>
			{#if hideCase}Thank you{:else}<CueChip {cue} /> <span class="sr">Run complete</span>{/if}
		</h1>
		{#if hideCase}<p class="lead">That run is done. Two quick questions about the signal, then the next one.</p>{/if}
	</header>

	<div class="grid" class:solo={hideCase}>
		{#if !hideCase}
		<section class="what" aria-labelledby="sum-title">
			<div class="what-head">
				<h2 id="sum-title">What was measured</h2>
				<Button size="sm" href="/replays/run/{blockKey}">Watch the whole run</Button>
			</div>
			<dl class="stats">
				<div><dt>Power-ups</dt><dd class="num">{trials}</dd></div>
				<div><dt title="Power-ups where the player had to decide about the end: turned away or stayed on. The rates use these.">Decisions measured</dt><dd class="num">{d?.counted ?? localDecisions ?? '-'}</dd></div>
				<div><dt>{outcomeLabel('timely-retreat')}</dt><dd class="num good">{d ? `${d.wellTimed}` : '-'} <small>{d ? share(d.wellTimed, d.counted) : ''}</small></dd></div>
				<div><dt>{outcomeLabel('caught')}</dt><dd class="num bad">{d ? `${d.caught}` : '-'} <small>{d ? share(d.caught, d.counted) : ''}</small></dd></div>
				<div><dt>Replays saved</dt><dd class="num">{d?.clips ?? '-'}</dd></div>
			</dl>
			{#if trials > 0}
				<OutcomeBar {outcomes} height={8} />
				<ul class="mix">
					{#each OUTCOME_ORDER.filter((o) => (outcomes[o] ?? 0) > 0) as o (o)}
						<li><span class="dot" style:background={outcomeColor(o)}></span><span class="num">{outcomes[o]}</span> {outcomeLabel(o).toLowerCase()}</li>
					{/each}
				</ul>
			{:else if d || !res.isLoading}
				<p class="empty">No power-up was finished in this run.</p>
			{/if}

			{#if d && d.rows.length}
				<div class="table-wrap">
					<table>
						<caption class="visually-hidden">Power-ups in this run</caption>
						<thead><tr><th scope="col">#</th><th scope="col" class="n">Power</th><th scope="col">What happened</th><th scope="col" class="n" title="Power left when the player turned away from the ghost (or ate it)">Turned away</th><th scope="col" class="n eats">Ghosts eaten</th><th scope="col"><span class="visually-hidden">Replay</span></th></tr></thead>
						<tbody>
							{#each d.rows as t (t._id)}
								<tr class:dim={!t.counted}>
									<td class="num">{t.n}</td>
									<td class="n num">{secs(t.total)}</td>
									<td class="what-cell">
										<span class="dot" style:background={outcomeColor(t.outcome)}></span>{outcomeLabel(t.outcome)}
										{#if t.reason}<small class="why" title="Not counted: {lower(t.reason)}">not counted <sup class="fn">{reasonNo(t.reason)}</sup></small>{/if}
									</td>
									<td class="n num">{turnWords(t.outcome, t.turnLeft, t.lastChaseEnd) ?? '-'}</td>
									<td class="n num eats">{t.eats}</td>
									<td>{#if t.clipId}<a href={replayHref(t._id, { run: blockKey })}>Replay</a>{:else}<a class="dim" href={replayHref(t._id, { run: blockKey })} title="No clip was kept for this one; its numbers and distance chart are there">Details</a>{/if}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="note"><a href={`/replays?${new URLSearchParams({ ...(d.source !== 'human' ? { source: d.source } : {}), p: d.participantId })}`}>All replays of {who || 'this participant'}</a></p>
				{#if notCounted.length}
					<div class="note">
						<p>{notCounted.length} of {d.rows.length} power-up{d.rows.length === 1 ? '' : 's'} {notCounted.length === 1 ? 'does' : 'do'} not count toward the rates{d.oldRules ? `, ${d.oldRules} of them because they were recorded under older rules` : ''}:</p>
						<ol class="reasons">
							{#each reasons as r, i (r.text)}
								<li><sup class="fn">{i + 1}</sup> {r.text} <span class="num dim">({r.n})</span></li>
							{/each}
						</ol>
					</div>
				{/if}
			{:else if res.isLoading || (!d && recent.length)}
				<p class="empty">{waiting.offline ? "Can't reach the database. What was measured is kept on this machine and sent when it is back." : waiting.late ? 'Still waiting for the server: it is connected but slow to answer. This fills in by itself.' : 'Waiting for the server...'}</p>
			{/if}
		</section>
		{/if}

		<section class="ask" aria-labelledby="ask-title">
			<h2 id="ask-title">{hideCase ? 'Two questions' : 'Ask the participant'} <span class="opt">optional</span></h2>
			{#if asked === 'open'}
				<Scale7 question="I could tell when the power was about to run out." low="Not at all" high="Completely" bind:value={clarity} />
				<Scale7 question="The signal got in the way of playing." low="Not at all" high="Very much" bind:value={distraction} />
				<div class="ask-actions">
					<Button variant="quiet" disabled={clarity === null || distraction === null} onclick={save}>Save answers</Button>
					<Button variant="ghost" onclick={() => (asked = 'skipped')}>Skip</Button>
				</div>
				{#if clarity !== null || distraction !== null}<p class="dim small">Not saved yet: kept on this machine until you save or skip.</p>{/if}
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
				Next case: <span class="num">{next.code}</span>{hideCase ? '' : ` · ${next.name}`} <span class="k"><Kbd>N</Kbd></span>
			</Button>
		{/if}
		<Button size="lg" onclick={onagain}>Play this case again</Button>
		<Button size="lg" variant="ghost" href="/">Back to console <span class="k"><Kbd>Esc</Kbd></span></Button>
	</footer>
	{#if hideCase}<p class="dim small">Researcher: press <Kbd>V</Kbd> for what this run measured and its replays.</p>{/if}
</div>

<style>
	.what-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); }
	.what-head h2 { margin: 0; }
	.summary { width: 100%; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-4); padding-bottom: var(--space-3); }
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
	.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--ink-faint); vertical-align: 1px; flex: none; }
	.mix .dot { margin-right: 0; }
	/* Every row shows: the page scrolls, not a box inside it. */
	.table-wrap { overflow-x: auto; }
	.grid.solo { grid-template-columns: minmax(0, 640px); }
	.lead { color: var(--ink-dim); margin-top: var(--space-2); }
	table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
	th, td { padding: 6px 8px; border-bottom: 1px solid var(--rule); text-align: left; white-space: nowrap; vertical-align: top; }
	thead th { position: sticky; top: 0; background: var(--surface); color: var(--ink-dim); font-size: var(--text-xs); font-weight: 600; }
	.n { text-align: right; }
	.what-cell { white-space: normal; min-width: 180px; }
	.why { margin-left: 6px; color: var(--ink-faint); font-size: var(--text-xs); white-space: nowrap; }
	.fn { font-size: 0.75em; font-weight: 700; color: var(--ink-dim); }
	.reasons { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--text-xs); }
	tr.dim td { color: var(--ink-dim); }
	.dim { color: var(--ink-faint); }
	.small { font-size: var(--text-xs); }
	.note { color: var(--ink-dim); font-size: var(--text-sm); }
	.empty { color: var(--ink-dim); }
	.ask-actions { display: flex; gap: var(--space-2); }
	.done { color: var(--good); }
	.link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-size: var(--text-sm); text-decoration: underline; cursor: pointer; align-self: flex-start; }
	/* The next step is always in reach: on a short window the actions stay at the bottom while the rows scroll. */
	.go { position: sticky; bottom: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-3) 0; background: var(--bg); border-top: 1px solid var(--rule); }
	.k { margin-left: 6px; opacity: 0.75; }
	.k :global(kbd) { background: transparent; color: inherit; border-color: currentColor; }
	@media (max-width: 560px) {
		.eats { display: none; }
		th, td { padding: 6px 4px; }
		td.n { white-space: normal; }
		.what-cell { min-width: 0; }
	}
	/* Below this the table and the questions do not both fit side by side: the questions go under it. */
	@media (max-width: 1100px) {
		.grid { grid-template-columns: minmax(0, 1fr); }
	}
	@media (max-width: 860px) {
		.stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.go :global(.btn) { flex: 1 1 100%; }
	}
</style>
