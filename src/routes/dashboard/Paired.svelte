<script lang="ts">
	/**
	 * Within people: the comparison a within-subject design calls for. For each condition, the
	 * difference against a yardstick (the timer bar, the classic blink or no signal) worked out inside
	 * each person who played both, then averaged over people, with a 95% interval over people; the
	 * same for turn-away time against the timer bar; how precise the study is so far and what it
	 * would take; and breakdowns (block position, power length, sound, input) as the within-person
	 * difference between two levels, pooled and per condition.
	 */
	import { CueChip, EmptyState, InfoTip, Panel, Segmented } from '#lib/ui/index.ts';
	import DiffChart, { type DiffRow } from '#lib/charts/DiffChart.svelte';
	import { condition, type Condition } from '#lib/charts/encoding.ts';
	import { DEFS } from './defs';
	import { rankable } from './insight';
	import { orderedRows, takeOf } from './rows';
	import type { Comparison, Main, RowOrder } from './types';

	interface Props {
		main: Main;
		order: RowOrder;
		selected: string | null;
		onselect: (id: string) => void;
	}
	let { main, order, selected, onselect }: Props = $props();

	type RateKey = 'wellTimed' | 'tooLate' | 'tooEarly';
	type Measure = RateKey | 'turn';
	type Yard = 'timer-bar' | 'classic-blink' | 'none';
	const RATE_WORD: Record<Measure, string> = { wellTimed: 'turned away in time', tooLate: 'too late', tooEarly: 'too early', turn: 'median turn-away time' };
	let ref = $state<Yard>('timer-bar');
	let rate = $state<Measure>('wellTimed');

	const groups = $derived(takeOf(main).groups);
	const turnMode = $derived(rate === 'turn');
	const yard = $derived<Yard>(turnMode ? 'timer-bar' : ref);
	const refName = $derived(yard === 'none' ? 'no signal' : `the ${condition(yard).name.toLowerCase()}`);
	const family = $derived<Comparison[]>(turnMode ? main.turnVsTimer : main.paired[yard][rate as RateKey]);
	const refStats = $derived(main.cues.find((c) => c.cue === yard) ?? null);
	/** The yardstick itself has too little data for a fair comparison: every row is drawn faint. */
	const refThin = $derived(!refStats || !rankable(refStats));
	const unitOf = (x: number | null) => (x === null ? '–' : turnMode ? `${x > 0 ? '+' : ''}${x.toFixed(2)} s` : `${x > 0 ? '+' : ''}${Math.round(x * 100)} pts`);
	const pv = (x: number | null) => (x === null ? '–' : x < 0.001 ? 'below 0.001' : x.toFixed(3));

	const diffRows = $derived.by((): DiffRow[] => {
		const byId = new Map(family.map((c) => [c.a, c]));
		return orderedRows(main.cues, order, groups)
			.filter((r) => r.cond.id !== yard)
			.map((r) => {
				const c = byId.get(r.cond.id);
				return {
					id: r.cond.id,
					cond: r.cond,
					diff: c?.diff ?? null,
					lo: c?.lo ?? null,
					hi: c?.hi ?? null,
					people: c?.people ?? 0,
					clear: !!c?.clear,
					thin: !c || c.lo === null || refThin,
					group: r.group,
					info: c
						? ([
							[`Difference in ${RATE_WORD[rate]}`, unitOf(c.diff)],
							['95% interval (over people)', c.lo === null ? 'needs 5 people' : `${unitOf(c.lo)} to ${unitOf(c.hi)}`],
							['People who played both', String(c.people)],
							['p, this comparison alone', pv(c.p)],
							[`p, adjusted for ${family.length} comparisons`, pv(c.pAdj)],
							['Verdict', c.clear ? 'clear' : c.p === null ? 'too few people to test' : 'could be chance']
						] as [string, string][])
						: [['People who played both', '0']]
				};
			});
	});
	const span = $derived.by(() => {
		const m = Math.max(turnMode ? 0.5 : 0.2, ...diffRows.flatMap((r) => [Math.abs(r.lo ?? 0), Math.abs(r.hi ?? 0), Math.abs(r.diff ?? 0)]));
		return turnMode ? Math.ceil(m * 2) / 2 : Math.min(100, Math.ceil((m * 100) / 10) * 10);
	});
	const better = $derived(
		turnMode ? (['turned later', 'turned earlier'] as [string, string]) : rate === 'wellTimed' ? (['worse', 'better'] as [string, string]) : (['better', 'worse'] as [string, string])
	);
	const clearOnes = $derived(diffRows.filter((r) => r.clear && r.diff !== null));
	const anyPairs = $derived(family.some((c) => c.people > 0));

	// How precise ---------------------------------------------------------------------------------
	const pr = $derived(main.precision);
	const nameOf = (id: string) => condition(id).name;

	// Breakdowns --------------------------------------------------------------------------------------
	type FactorKey = 'half' | 'power' | 'sound' | 'input';
	const FACTOR_LABEL: Record<FactorKey, string> = { half: 'Block position', power: 'Power length', sound: 'Sound', input: 'Input' };
	const FACTOR_SUB: Record<FactorKey, string> = {
		half: 'Is a condition better when played later in the session? The counterbalanced order should spread practice evenly.',
		power: 'Long (6 s or more) against short (under 6 s) power-ups. A good signal works for both.',
		sound: 'With sound on against off. Cues with a sound part may depend on it.',
		input: 'By how the player steered. Touch is harder to steer precisely.'
	};
	let factor = $state<FactorKey>('half');
	let bRate = $state<RateKey>('wellTimed');
	const bd = $derived(main.breakdowns[factor]);
	const bRows = $derived.by((): DiffRow[] => {
		if (!bd.diffs || !bd.compared) return [];
		const [lv0, lv1] = bd.compared;
		const fam = bd.diffs[bRate];
		const byId = new Map(fam.cues.map((c) => [c.a, c]));
		const all: Condition = { ...condition('all'), id: 'all', code: '', name: 'All conditions', color: 'var(--ink-dim)', shape: 'circle' };
		const n = (id: string, lv: string) => bd.counts[id]?.[lv]?.[0] ?? 0;
		const row = (id: string, cond: Condition, c: Comparison | undefined, group?: string): DiffRow => ({
			id, cond, group,
			diff: c?.diff ?? null, lo: c?.lo ?? null, hi: c?.hi ?? null, people: c?.people ?? 0, clear: !!c?.clear,
			thin: !c || c.lo === null,
			info: [
				[`${lv1} minus ${lv0}`, unitPts(c?.diff ?? null)],
				['95% interval', c && c.lo !== null ? `${unitPts(c.lo)} to ${unitPts(c.hi)}` : 'needs 5 people'],
				[bd.between ? 'People (two groups)' : 'People who played both', String(c?.people ?? 0)],
				['Counted power-ups', `${lv0}: ${n(id, lv0)}, ${lv1}: ${n(id, lv1)}`],
				['Verdict', c?.clear ? 'clear' : c?.p === null || !c ? 'too few people to test' : 'could be chance']
			]
		});
		return [
			row('all', all, fam.all),
			...orderedRows(main.cues, order, null).map((r, i) => row(r.cond.id, r.cond, byId.get(r.cond.id), i === 0 ? 'Per condition (adjusted together)' : undefined))
		];
	});
	const unitPts = (x: number | null) => (x === null ? '–' : `${x > 0 ? '+' : ''}${Math.round(x * 100)} pts`);
	const bSpan = $derived.by(() => {
		const m = Math.max(0.2, ...bRows.flatMap((r) => [Math.abs(r.lo ?? 0), Math.abs(r.hi ?? 0), Math.abs(r.diff ?? 0)]));
		return Math.min(100, Math.ceil((m * 100) / 10) * 10);
	});
	const bAll = $derived(bd.diffs?.[bRate].all ?? null);
	const bClear = $derived(bRows.filter((r) => r.id !== 'all' && r.clear));
	const oneLevelText: Record<FactorKey, string> = {
		half: 'Block position needs study sessions with more than six blocks.',
		power: 'Every counted power-up here has a similar length, so there is nothing to compare.',
		sound: 'Every counted power-up here was played with the same sound setting, so there is nothing to compare.',
		input: 'Every counted power-up here was played with the same input, so there is nothing to compare.'
	};
</script>

<section class="within" aria-labelledby="within-h">
	<header class="sec-head">
		<div>
			<p class="eyebrow">Within people</p>
			<h2 id="within-h">Each condition against the yardsticks, inside each person</h2>
		</div>
	</header>

	<Panel
		title="Difference from {refName}, person by person"
		sub={turnMode
			? 'For everyone who played both, their median turn-away time under the condition minus under the timer bar, averaged over those people. Positive: turned away with more time left. Bars: 95% intervals over people.'
			: `For everyone who played both, their ${RATE_WORD[rate]} rate under the condition minus under ${refName}, averaged over those people. Bars: 95% intervals over people. A bar clear of zero${family.length > 1 ? `, after adjusting for all ${family.length} comparisons,` : ''} is marked clear.`}
	>
		{#snippet actions()}
			<div class="ctl">
				{#if !turnMode}
					<Segmented
						label="Compared with"
						size="sm"
						options={[{ value: 'timer-bar', label: 'Timer bar' }, { value: 'classic-blink', label: 'Classic blink' }, { value: 'none', label: 'No signal' }]}
						bind:value={ref}
					/>
				{/if}
				<Segmented
					label="Measure"
					size="sm"
					options={[{ value: 'wellTimed', label: 'In time' }, { value: 'tooLate', label: 'Too late' }, { value: 'tooEarly', label: 'Too early' }, { value: 'turn', label: 'Turn-away time' }]}
					bind:value={rate}
				/>
				<InfoTip term="Paired difference" align="end">{turnMode ? DEFS.turnPaired : DEFS.paired}</InfoTip>
			</div>
		{/snippet}
		{#if !anyPairs}
			<EmptyState compact icon="chart" title="Nobody has played {refName} and another condition yet">
				The comparison needs people who played both.
			</EmptyState>
		{:else}
			{#if refThin}
				<p class="warn-note">
					{refName.charAt(0).toUpperCase() + refName.slice(1)} has too little data to compare against ({refStats?.decisions ?? 0} counted
					from {refStats?.decisionParticipants ?? 0} {refStats?.decisionParticipants === 1 ? 'person' : 'people'}), so every row is drawn faint.
				</p>
			{/if}
			<DiffChart
				rows={diffRows}
				{span}
				ends={better}
				zeroLabel="same as {refName}"
				{selected}
				{onselect}
				scale={turnMode ? 1 : 100}
				unit={turnMode ? 's' : 'pts'}
				decimals={turnMode ? 2 : 0}
				caption="Paired difference in {RATE_WORD[rate]} against {refName} per condition, with 95% intervals over people"
			>
				{#snippet label(row)}<CueChip cue={row.cond} size="sm" />{/snippet}
			</DiffChart>
			<p class="foot">
				{#if clearOnes.length}
					Clear: {clearOnes.map((r) => `${r.cond.code} ${r.cond.name} (${unitOf(r.diff)})`).join(', ')}. Everything else could be chance.
				{:else}
					No condition differs clearly from {refName} on this measure yet.
				{/if}
				{#if diffRows.some((r) => r.lo === null && r.diff !== null)}Hollow points: fewer than 5 people played both, so there is no interval or test.{/if}
			</p>
		{/if}
	</Panel>

	<Panel title="How precise is this?" sub="What the current data can and cannot tell apart.">
		{#snippet actions()}<InfoTip term="People needed" align="end">{DEFS.precision}</InfoTip>{/snippet}
		{#if pr.people === 0 || pr.perPersonCondition === null}
			<p class="prec">No counted power-ups yet.</p>
		{:else}
			<ul class="prec">
				<li>
					Each person gives a median of <b class="num">{pr.perPersonCondition}</b>
					counted power-up{pr.perPersonCondition === 1 ? '' : 's'} per condition ({pr.people} {pr.people === 1 ? 'person' : 'people'} with counted power-ups).
				</li>
				{#if pr.halfWidth !== null}
					<li>
						A condition's difference from the timer bar is currently known to within about
						<b class="num">±{Math.round(pr.halfWidth * 100)} points</b> (median 95% interval, turned away in time).
					</li>
				{:else}
					<li>Too few people played the timer bar and another condition to put an interval on a difference yet.</li>
				{/if}
				{#if pr.needed !== null}
					<li>
						To detect a <b>{Math.round(pr.target * 100)}-point</b> difference from the timer bar reliably, about
						<b class="num">{pr.needed} people</b> are needed at this rate of counted power-ups per person
						({pr.neededSingle} for a single planned comparison).
					</li>
				{/if}
				{#if pr.top && pr.top.gap !== null}
					<li>
						The two highest, {nameOf(pr.top.a)} and {nameOf(pr.top.b)}, are <b class="num">{Math.round(Math.abs(pr.top.gap) * 100)} points</b> apart
						({pr.top.people} people played both). Telling them apart at that gap, allowing for every pair, would take about
						<b class="num">{pr.top.needed.toLocaleString('en-GB')} people</b>.
					</li>
				{/if}
			</ul>
		{/if}
	</Panel>

	<Panel title="Does it depend on how it was played?" sub={FACTOR_SUB[factor]}>
		{#snippet actions()}
			<div class="ctl">
				<Segmented
					label="Breakdown"
					size="sm"
					options={(Object.keys(FACTOR_LABEL) as FactorKey[]).map((k) => ({ value: k, label: FACTOR_LABEL[k] }))}
					bind:value={factor}
				/>
				<Segmented label="Rate" size="sm" options={[{ value: 'wellTimed', label: 'In time' }, { value: 'tooLate', label: 'Too late' }, { value: 'tooEarly', label: 'Too early' }]} bind:value={bRate} />
				<InfoTip term="Breakdowns" align="end">{DEFS.breakdown}</InfoTip>
			</div>
		{/snippet}
		{#if !bd.compared || !bd.diffs}
			<EmptyState compact icon="chart" title="Nothing to compare yet">{oneLevelText[factor]}</EmptyState>
		{:else}
			<p class="b-lead">
				<b>{bd.compared[1]}</b> minus <b>{bd.compared[0]}</b>, {RATE_WORD[bRate]} rate,
				{bd.between ? 'people at one level against people at the other (fewer than 5 people played both)' : 'inside each person who played both'}.
				{#if bAll && bAll.diff !== null}
					Over all conditions: <b class="num">{unitPts(bAll.diff)}</b>{bAll.lo !== null ? ` (95% ${unitPts(bAll.lo)} to ${unitPts(bAll.hi)}, ${bAll.people} people)` : ` (${bAll.people} people, too few to test)`}, {bAll.clear ? 'a clear difference' : bAll.p === null ? 'no test yet' : 'could be chance'}.
				{/if}
			</p>
			<DiffChart
				rows={bRows}
				span={bSpan}
				ends={bRate === 'wellTimed' ? [`better at ${bd.compared[0].toLowerCase()}`, `better at ${bd.compared[1].toLowerCase()}`] : [`better at ${bd.compared[1].toLowerCase()}`, `better at ${bd.compared[0].toLowerCase()}`]}
				zeroLabel="no difference"
				{selected}
				onselect={(id) => id !== 'all' && onselect(id)}
				caption="{bd.compared[1]} minus {bd.compared[0]} in {RATE_WORD[bRate]} rate, all conditions and per condition, with 95% intervals"
			>
				{#snippet label(row)}
					{#if row.id === 'all'}<span class="all">All conditions</span>{:else}<CueChip cue={row.cond} size="sm" />{/if}
				{/snippet}
			</DiffChart>
			<p class="foot">
				{#if bClear.length}Clear per condition: {bClear.map((r) => `${r.cond.code} ${r.cond.name} (${unitPts(r.diff)})`).join(', ')}.{:else}No single condition differs clearly between the two levels.{/if}
				Per-condition rows are adjusted together for {bRows.length - 1} comparisons; hollow points have fewer than 5 people to test.
				{#if bd.levels.length > 2}Other levels seen: {bd.levels.slice(2).join(', ')} (not compared).{/if}
			</p>
		{/if}
	</Panel>
</section>

<style>
	.within {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
	}
	.sec-head h2 {
		font-size: var(--text-xl);
	}
	.foot {
		margin-top: var(--space-3);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.prec {
		display: grid;
		gap: var(--space-2);
		max-width: 90ch;
		margin: 0;
		padding-left: 1.1em;
		color: var(--ink-dim);
	}
	.prec b {
		color: var(--ink);
	}
	.ctl {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		max-width: 100%;
	}
	.warn-note,
	.b-lead {
		max-width: 90ch;
		margin-bottom: var(--space-3);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.b-lead b {
		color: var(--ink);
	}
	.all {
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 650;
	}
</style>
