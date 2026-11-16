<script lang="ts">
	/**
	 * The answer first: the takeaway in words (only as strong as the adjusted comparisons allow),
	 * what it rests on (and what was recorded but not counted, with the reason), and the ranking of
	 * all thirteen conditions on the well-timed rate, with the two ways to misjudge the end beside it
	 * (too late, of which caught is the worst part, and too early), with the references and the timer
	 * bar drawn as yardstick lines. Every rate is over decision trials.
	 */
	import type { Snippet } from 'svelte';
	import { CueChip, InfoTip, Panel, Stat } from '#lib/ui/index.ts';
	import { outcomeLabel } from '#lib/outcomes.ts';
	import ForestChart, { type ForestColumn, type ForestRef, type ForestRow } from '#lib/charts/ForestChart.svelte';
	import Legend from '#lib/charts/Legend.svelte';
	import RoleMark from '#lib/charts/RoleMark.svelte';
	import { CONDITIONS, condition, pct, plural, ROLE_COLOR, YARDSTICKS } from '#lib/charts/encoding.ts';
	import { DEFS } from './defs';
	import { ENOUGH, insight, type Cmp } from './insight';
	import { orderedRows } from './rows';
	import type { Main, RunInfo } from './types';

	interface Props {
		main: Main;
		selected: string | null;
		onselect: (id: string) => void;
		simulated: boolean;
		/** The simulator run shown (simulated view). */
		run?: RunInfo | null;
		otherRun?: boolean;
		/** Extra line under the "not counted" note (e.g. a route to the simulated view). */
		uncounted?: Snippet;
	}
	let { main, selected, onselect, simulated, run = null, otherRun = false, uncounted }: Props = $props();

	const take = $derived(insight(main.cues, (id) => condition(id), CONDITIONS.map((c) => c.id), {
		pairs: main.pairs as Record<'wellTimed' | 'tooLate' | 'tooEarly', Cmp[]>,
		vsTimer: main.paired['timer-bar'].wellTimed as Cmp[]
	}));
	const rows = $derived(orderedRows(main.cues, 'rank'));
	const ranked = $derived(rows.filter((r) => !r.thin).length);

	/** Why power-ups were recorded but not counted, largest first, in plain words. */
	const REASON: Record<string, string> = {
		'old-rules': 'recorded before the current rules',
		'left-early': 'the player did not stay for the 3 s after the end'
	};
	const notCounted = $derived(Object.entries(main.totals.notCounted ?? {})
		.sort((a, b) => b[1] - a[1])
		.map(([why, k]) => `${k} ${REASON[why] ?? outcomeLabel(why).toLowerCase()}`));

	/** Yardstick lines: only for references with enough data, so a thin yardstick never misleads. */
	function refs(key: 'wellTimed' | 'tooLate' | 'tooEarly'): ForestRef[] {
		return YARDSTICKS.flatMap((id) => {
			const s = main.cues.find((c) => c.cue === id);
			if (!s || s.decisions < ENOUGH || s[key].rate === null) return [];
			const c = condition(id);
			return [{ id, code: c.code, name: c.name, value: s[key].rate!, color: c.color, dash: c.dash }];
		});
	}
	const columns = $derived<ForestColumn[]>([
		{ key: 'wellTimed', title: 'Turned away in time', better: 'higher', refs: refs('wellTimed') },
		{ key: 'tooLate', title: 'Too late', better: 'lower', refs: refs('tooLate') },
		{ key: 'tooEarly', title: 'Too early', better: 'lower', refs: refs('tooEarly') }
	]);
	const forestRows = $derived<ForestRow[]>(rows.map((r) => ({
		id: r.cond.id,
		cond: r.cond,
		thin: r.thin,
		group: r.group,
		values: { wellTimed: r.s?.wellTimed ?? null, tooLate: r.s?.tooLate ?? null, tooEarly: r.s?.tooEarly ?? null },
		empty: r.s && r.s.trials > 0 ? `none counted (${r.s.trials} recorded)` : undefined,
		note: r.s
			? `${plural(r.s.decisions, 'counted power-up')} from ${plural(r.s.decisionParticipants, 'participant')}; caught ${pct(r.s.caught.rate)} (part of too late); ${r.s.gaveUpEarly ? `gave up very early ${pct(r.s.gaveUpEarly.k / Math.max(1, r.s.gaveUpEarly.n))} (part of too early); ` : ''}${plural(r.s.catches.n, 'catch', 'catches')} not counted; ${r.s.interval === 'bootstrap' ? 'intervals clustered by participant' : 'Wilson intervals (under 3 people)'}`
			: undefined
	})));
	const yardsticksDrawn = $derived(columns[0].refs.length > 0);
	const presetWord = (p: string) => (p === 'flat' ? 'flat' : p === 'planted' ? 'planted' : p);
</script>

<section class="answer" aria-labelledby="answer-h">
	<h2 id="answer-h" class="visually-hidden">The answer</h2>
	<div class="takeaway tone-{take.tone}">
		<p class="eyebrow">
			{#if simulated && otherRun}
				Pipeline check: simulated play outside any run
			{:else if simulated && run}
				Pipeline check on one simulator run: {presetWord(run.preset)}, {plural(run.sessions, 'player')}, {plural(run.trials, 'power-up')}
			{:else if simulated}
				Pipeline check on simulated players
			{:else}
				The answer so far
			{/if}
			<InfoTip term="How strong is this?" align="start">
				A condition is ranked only with {ENOUGH} or more counted power-ups. A difference is called clear only when it holds
				inside each person (paired) and survives Holm's adjustment for every comparison made at once (78 pairs of the 13
				conditions; 12 against the timer bar). Anything weaker is reported as possibly chance. <a href="#method">How this is measured</a>
			</InfoTip>
		</p>
		<p class="headline">{take.headline}</p>
		{#if take.details.length}
			<ul class="details">
				{#each take.details as d (d)}<li>{d}</li>{/each}
			</ul>
		{/if}
		{#if simulated && run?.preset === 'flat'}
			<p class="flat-note">This run gave every condition the same awareness, so any difference here is noise. Seeing none is the expected result.</p>
		{/if}
	</div>

	<div class="basis">
		<Stat label="Participants" value={main.totals.participants} info={DEFS.participants} sub={plural(main.totals.sessions, 'session')} />
		<Stat label="Power-ups" value={main.totals.trials} info={DEFS.trial} sub="{main.totals.engaged} engaged" />
		<Stat label="Counted" value={main.totals.decisions} info={DEFS.counted} sub="decisions behind every rate" />
		<Stat
			label="Ranked conditions"
			value={ranked}
			unit="of 13"
			info={DEFS.notEnough}
			sub={ranked < 13 ? `${13 - ranked} under ${ENOUGH} counted` : 'all have enough data'}
			tone={ranked === 0 ? 'warn' : 'ink'}
		/>
	</div>
	{#if notCounted.length}
		<div class="uncounted">
			<p>
				<b>Not counted:</b> {notCounted.join('; ')}.
				{#if main.totals.oldRules}
					Power-ups recorded before the current rules lack a measure the rules need, so they stay out of every rate.
				{/if}
			</p>
			{@render uncounted?.()}
		</div>
	{/if}

	<Panel title="Which signal tells players best" sub="Every condition ranked on turning away in time, with the two ways to get the end wrong beside it. 95% intervals clustered by participant. Click a row for its details.">
		{#snippet actions()}
			<span class="defs">
				What the columns mean
				<InfoTip term="The three columns" align="end">
					<b>Turned away in time.</b> {DEFS.wellTimed}<br /><br />
					<b>Too late.</b> {DEFS.tooLate} {DEFS.caught}<br /><br />
					<b>Too early.</b> {DEFS.tooEarly}<br /><br />
					<b>Not in any column.</b> {DEFS.catches}<br /><br />
					{DEFS.interval}
				</InfoTip>
			</span>
		{/snippet}
		<div class="legend-row">
			<Legend
				label="Condition roles"
				items={[
					{ label: 'Reference (A no signal, B classic blink)', color: ROLE_COLOR.reference, shape: 'diamond' },
					{ label: 'Timer bar (0)', color: ROLE_COLOR.baseline, shape: 'square' },
					{ label: 'Idea (1-10)', color: ROLE_COLOR.idea, shape: 'circle' },
					{ label: `Under ${ENOUGH} counted`, color: 'var(--ink-dim)', shape: 'circle', hollow: true }
				]}
			/>
			{#if yardsticksDrawn}
				<p class="yard-note">
					Vertical lines mark the yardsticks:
					{#each columns[0].refs as r, i (r.id)}
						<span class="yard"><RoleMark shape={condition(r.id).shape} color={r.color} size={10} /> {r.code} {r.name}</span>{i < columns[0].refs.length - 1 ? ', ' : '.'}
					{/each}
					Separate intervals here are not enough to call a difference clear: see "Within people" below for the paired comparisons.
				</p>
			{:else}
				<p class="yard-note">Yardstick lines appear once no signal, classic blink or the timer bar has {ENOUGH} counted power-ups.</p>
			{/if}
		</div>
		<ForestChart
			rows={forestRows}
			{columns}
			{selected}
			{onselect}
			caption="Turned away in time, too late and too early per condition, with 95% intervals clustered by participant"
		>
			{#snippet label(row)}
				<span class="lab">
					<CueChip cue={row.cond} size="sm" />
				</span>
			{/snippet}
		</ForestChart>
	</Panel>
</section>

<style>
	.answer {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
	}
	.takeaway {
		padding: var(--space-5) var(--space-5) var(--space-5) calc(var(--space-5) + 4px);
		border-radius: var(--radius-lg);
		background: linear-gradient(90deg, var(--accent-soft), transparent 70%), var(--surface);
		border: 1px solid var(--rule);
		box-shadow: inset 4px 0 0 var(--accent);
	}
	.takeaway.tone-thin,
	.takeaway.tone-empty,
	.takeaway.tone-none,
	.takeaway.tone-some {
		background: var(--surface);
		box-shadow: inset 4px 0 0 var(--ink-faint);
	}
	.takeaway.tone-thin,
	.takeaway.tone-empty {
		box-shadow: inset 4px 0 0 var(--warn);
	}
	.eyebrow {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin-bottom: var(--space-2);
	}
	.headline {
		max-width: 62ch;
		font-size: var(--text-xl);
		font-weight: 700;
		line-height: 1.3;
		text-wrap: pretty;
	}
	.details {
		display: grid;
		gap: 2px;
		max-width: 86ch;
		margin: var(--space-3) 0 0;
		padding-left: 1.1em;
		color: var(--ink-dim);
	}
	.flat-note {
		max-width: 86ch;
		margin-top: var(--space-3);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.basis {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.uncounted {
		display: grid;
		gap: var(--space-1);
		margin-top: calc(-1 * var(--space-2));
		padding: 0 var(--space-5);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.uncounted b {
		color: var(--ink);
	}
	.defs {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--ink-dim);
		font-size: var(--text-xs);
	}
	.legend-row {
		display: grid;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}
	.yard-note {
		max-width: 90ch;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.yard {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--ink-dim);
	}
	.lab {
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
	}
	a {
		color: var(--focus);
	}
	@media (max-width: 760px) {
		.basis {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.headline {
			font-size: var(--text-lg);
		}
	}
</style>
