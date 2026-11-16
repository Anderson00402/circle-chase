<script lang="ts">
	/**
	 * Within people: the comparison a within-subject design calls for. For each condition, the
	 * difference against the timer bar (or no signal) worked out inside each person who played both,
	 * then averaged over people, with a 95% interval over people; how precise the study is so far and
	 * how many people it would need; and compact breakdowns (block position, power length, sound,
	 * input), each shown only where the data can carry it.
	 */
	import { wilson } from '#convex/lib/stats.ts';
	import { CueChip, EmptyState, InfoTip, Panel, Segmented } from '#lib/ui/index.ts';
	import DiffChart, { type DiffRow } from '#lib/charts/DiffChart.svelte';
	import ForestChart, { type ForestRow } from '#lib/charts/ForestChart.svelte';
	import { condition, type Condition } from '#lib/charts/encoding.ts';
	import { DEFS } from './defs';
	import { ENOUGH } from './insight';
	import { orderedRows } from './rows';
	import type { Comparison, Main, RowOrder } from './types';

	interface Props {
		main: Main;
		order: RowOrder;
		selected: string | null;
		onselect: (id: string) => void;
	}
	let { main, order, selected, onselect }: Props = $props();

	type RateKey = 'wellTimed' | 'tooLate' | 'tooEarly';
	const RATE_WORD: Record<RateKey, string> = { wellTimed: 'turned away in time', tooLate: 'too late', tooEarly: 'too early' };
	let ref = $state<'timer-bar' | 'none'>('timer-bar');
	let rate = $state<RateKey>('wellTimed');

	const refName = $derived(condition(ref).name.toLowerCase());
	const family = $derived<Comparison[]>(main.paired[ref][rate]);
	const pts = (x: number | null) => (x === null ? '–' : `${x > 0 ? '+' : ''}${Math.round(x * 100)} pts`);
	const pv = (x: number | null) => (x === null ? '–' : x < 0.001 ? 'below 0.001' : x.toFixed(3));

	const diffRows = $derived.by((): DiffRow[] => {
		const byId = new Map(family.map((c) => [c.a, c]));
		return orderedRows(main.cues, order)
			.filter((r) => r.cond.id !== ref)
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
					thin: !c || c.lo === null,
					group: r.group,
					info: c
						? ([
							[`Difference in ${RATE_WORD[rate]}`, pts(c.diff)],
							['95% interval (over people)', c.lo === null ? 'needs 3 people' : `${pts(c.lo)} to ${pts(c.hi)}`],
							['People who played both', String(c.people)],
							['p, this comparison alone', pv(c.p)],
							[`p, adjusted for ${family.length} comparisons`, pv(c.pAdj)],
							['Verdict', c.clear ? 'clear' : 'could be chance']
						] as [string, string][])
						: [['People who played both', '0']]
				};
			});
	});
	const span = $derived.by(() => {
		const m = Math.max(0.2, ...diffRows.flatMap((r) => [Math.abs(r.lo ?? 0), Math.abs(r.hi ?? 0), Math.abs(r.diff ?? 0)]));
		return Math.min(100, Math.ceil((m * 100) / 10) * 10);
	});
	const better = $derived(rate === 'wellTimed' ? ['worse', 'better'] : ['better', 'worse']) as [string, string];
	const clearOnes = $derived(diffRows.filter((r) => r.clear && r.diff !== null));
	const anyPairs = $derived(family.some((c) => c.people > 0));

	// How precise ---------------------------------------------------------------------------------
	const pr = $derived(main.precision);

	// Breakdowns --------------------------------------------------------------------------------------
	type FactorKey = 'half' | 'power' | 'sound' | 'input';
	const FACTOR_LABEL: Record<FactorKey, string> = { half: 'Block position', power: 'Power length', sound: 'Sound', input: 'Input' };
	const FACTOR_SUB: Record<FactorKey, string> = {
		half: 'Is a condition better when played later in the session? The counterbalanced order should spread practice evenly.',
		power: 'Short (under 6 s) against long (6 s or more) power-ups. A good signal works for both.',
		sound: 'With sound on against off. Cues with a sound part may depend on it.',
		input: 'By how the player steered. Touch is harder to steer precisely.'
	};
	let factor = $state<FactorKey>('half');
	let bRate = $state<RateKey>('wellTimed');
	const bd = $derived(main.breakdowns[factor]);
	const bIndex = $derived({ wellTimed: 1, tooLate: 2, tooEarly: 3 }[bRate]);
	const bRows = $derived.by((): ForestRow[] => {
		const all: Condition = { ...condition('all'), id: 'all', code: '', name: 'All conditions', color: 'var(--ink-dim)', shape: 'circle' };
		const ids = ['all', ...orderedRows(main.cues, order).map((r) => r.cond.id)];
		return ids.map((id, i) => {
			const cells = bd.counts[id] ?? {};
			const values = Object.fromEntries(bd.levels.map((lv) => {
				const c = cells[lv];
				return [lv, c ? wilson(c[bIndex], c[0]) : null];
			}));
			const thin = bd.levels.some((lv) => (cells[lv]?.[0] ?? 0) < ENOUGH);
			return {
				id, cond: id === 'all' ? all : condition(id), thin, values,
				group: i === 1 ? 'Per condition' : undefined,
				note: bd.levels.map((lv) => `${lv}: ${cells[lv]?.[0] ?? 0} counted`).join('; ')
			};
		});
	});
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
		title="Difference from the {refName}, person by person"
		sub="For everyone who played both, their {RATE_WORD[rate]} rate under the condition minus under the {refName}, averaged over those people. Bars: 95% intervals over people. A bar clear of zero, after adjusting for all {family.length} comparisons, is marked clear."
	>
		{#snippet actions()}
			<Segmented label="Compared with" size="sm" options={[{ value: 'timer-bar', label: 'Timer bar' }, { value: 'none', label: 'No signal' }]} bind:value={ref} />
			<Segmented label="Rate" size="sm" options={[{ value: 'wellTimed', label: 'In time' }, { value: 'tooLate', label: 'Too late' }, { value: 'tooEarly', label: 'Too early' }]} bind:value={rate} />
			<InfoTip term="Paired difference" align="end">{DEFS.paired}</InfoTip>
		{/snippet}
		{#if !anyPairs}
			<EmptyState compact icon="chart" title="Nobody has played the {refName} and another condition yet">
				The comparison needs people who played both.
			</EmptyState>
		{:else}
			<DiffChart
				rows={diffRows}
				{span}
				ends={better}
				zeroLabel="same as the {refName}"
				{selected}
				{onselect}
				caption="Paired difference in {RATE_WORD[rate]} rate against the {refName} per condition, with 95% intervals over people"
			>
				{#snippet label(row)}<CueChip cue={row.cond} size="sm" />{/snippet}
			</DiffChart>
			<p class="foot">
				{#if clearOnes.length}
					Clear: {clearOnes.map((r) => `${r.cond.code} ${r.cond.name} (${pts(r.diff)})`).join(', ')}. Everything else could be chance.
				{:else}
					No condition differs clearly from the {refName} on this rate yet. Hollow points: fewer than 3 people played both, so there is no interval.
				{/if}
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
			</ul>
		{/if}
	</Panel>

	<Panel title="Does it depend on how it was played?" sub={FACTOR_SUB[factor]}>
		{#snippet actions()}
			<Segmented
				label="Breakdown"
				size="sm"
				options={(Object.keys(FACTOR_LABEL) as FactorKey[]).map((k) => ({ value: k, label: FACTOR_LABEL[k] }))}
				bind:value={factor}
			/>
			<Segmented label="Rate" size="sm" options={[{ value: 'wellTimed', label: 'In time' }, { value: 'tooLate', label: 'Too late' }, { value: 'tooEarly', label: 'Too early' }]} bind:value={bRate} />
		{/snippet}
		{#if bd.levels.length < 2}
			<EmptyState compact icon="chart" title="Nothing to compare yet">{oneLevelText[factor]}</EmptyState>
		{:else}
			<ForestChart
				rows={bRows}
				columns={bd.levels.map((lv) => ({ key: lv, title: lv, better: bRate === 'wellTimed' ? 'higher' : 'lower', refs: [] }))}
				{selected}
				onselect={(id) => id !== 'all' && onselect(id)}
				caption="{RATE_WORD[bRate]} rate per condition by {FACTOR_LABEL[factor].toLowerCase()}"
			>
				{#snippet label(row)}
					{#if row.id === 'all'}<span class="all">All conditions</span>{:else}<CueChip cue={row.cond} size="sm" />{/if}
				{/snippet}
			</ForestChart>
			<p class="foot">
				Rates over counted power-ups with Wilson intervals (power-ups pooled, so a little too narrow). Faint rows have fewer than
				{ENOUGH} counted power-ups in at least one column: read them as a hint, not a result.
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
	.all {
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 650;
	}
</style>
