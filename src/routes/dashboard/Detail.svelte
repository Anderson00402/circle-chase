<script lang="ts">
	/**
	 * One condition up close: its headline numbers against the yardsticks, how its power-ups end,
	 * every turn-away time, its approach curve next to the yardsticks, and its latest power-ups with
	 * replays.
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { spread } from '#convex/lib/stats.ts';
	import { Badge, Button, CueChip, EmptyState, Select, Stat } from '#lib/ui/index.ts';
	import { outcomeLabel } from '#lib/outcomes.ts';
	import LineChart, { type LineSeries } from '#lib/charts/LineChart.svelte';
	import StackedBars from '#lib/charts/StackedBars.svelte';
	import StripPlot, { type StripPoint } from '#lib/charts/StripPlot.svelte';
	import Legend from '#lib/charts/Legend.svelte';
	import { CONDITIONS, condition, OUTCOMES, outcomeStyle, pct, pctRange, plural, RATE_COLOR, secs } from '#lib/charts/encoding.ts';
	import { CUES } from '#lib/game/cues/index.ts';
	import { DEFS } from './defs';
	import { ENOUGH } from './insight';
	import { inview } from './inview';
	import Recent from './Recent.svelte';
	import type { DashFilter, Main } from './types';

	interface Props {
		main: Main;
		filter: DashFilter;
		cue: string;
		now: number;
	}
	let { main, filter, cue = $bindable(), now }: Props = $props();

	const cond = $derived(condition(cue));
	const info = $derived(CUES.find((c) => c.id === cue));
	const s = $derived(main.cues.find((c) => c.cue === cue) ?? null);
	const thin = $derived((s?.decisions ?? 0) < ENOUGH);

	/** Paired difference against a yardstick, inside each person: "+12 pts vs 0 (95% -3 to +27, 18 people)". */
	function vs(key: 'wellTimed' | 'tooLate' | 'tooEarly'): string | undefined {
		const parts = (['timer-bar', 'none'] as const).filter((y) => y !== cue).map((y) => {
			const c = main.paired[y][key].find((x) => x.a === cue);
			if (!c || c.diff === null) return null;
			const f = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}`;
			const ci = c.lo !== null && c.hi !== null ? `95% ${f(c.lo)} to ${f(c.hi)}, ` : '';
			return `${f(c.diff)} pts vs ${condition(y).code} (${ci}${c.people} ${c.people === 1 ? 'person' : 'people'}${c.clear ? ', clear' : ''})`;
		}).filter(Boolean);
		return parts.length ? parts.join('; ') : undefined;
	}

	let seen = $state(false);
	const cueFilter = $derived({ ...filter, cue });
	const points = useQuery(api.dashboard.points, () => (seen ? cueFilter : 'skip'));
	// Approach curves of every condition (shared with the evidence section's query) and ratings.
	const approach = useQuery(api.dashboard.approach, () => (seen ? { ...filter } : 'skip'));
	const ratings = useQuery(api.dashboard.ratings, () => (seen ? { ...filter } : 'skip'));
	const rating = $derived(ratings.data?.cues.find((r) => r.cue === cue) ?? null);

	const strip = $derived.by(() => {
		const all = (points.data ?? []).filter((p) => p.inRates);
		const pt = (p: (typeof all)[number]): StripPoint => ({
			key: p.id, v: p.turnLeft ?? 0, color: outcomeStyle(p.outcome).color,
			href: p.clip ? `/replays/${p.id}` : undefined,
			info: [
				['Turned away', p.turnLeft === null ? 'never (still chasing at the end)' : `${p.turnLeft.toFixed(2)} s ${p.turnLeft >= 0 ? 'left' : 'after the end'}`],
				['Outcome', outcomeLabel(p.outcome)],
				['Power length', secs(p.total)], ['Participant', p.p !== null ? `P${p.p}, power-up ${p.trialIndex + 1}` : '–']
			]
		});
		const onAxis = all.filter((p) => p.turnLeft !== null);
		const sp = spread(onAxis.map((p) => p.turnLeft!));
		return [{
			id: cue, cond, thin, median: sp.median, q25: sp.q25, q75: sp.q75,
			points: onAxis.map(pt), extra: all.filter((p) => p.turnLeft === null).map(pt)
		}];
	});
	const stripDomain = $derived.by((): [number, number] => {
		const vs = strip[0].points.map((p) => p.v);
		return [Math.max(2.5, Math.ceil(Math.max(0, ...vs) * 2) / 2), Math.min(-0.5, Math.floor(Math.min(0, ...vs) * 2) / 2)];
	});
	const lines = $derived.by((): LineSeries[] => {
		const a = approach.data;
		if (!a) return [];
		const pctOf = (xs: (number | null)[]) => xs.map((v) => (v === null ? null : v * 100));
		return a.cues
			.filter((c) => c.cue === cue || c.cue === 'timer-bar')
			.sort((x) => (x.cue === cue ? 1 : -1))
			.map((c) => {
				const k = condition(c.cue);
				const mine = c.cue === cue;
				return {
					id: c.cue, label: k.code, name: `${k.code}. ${k.name} (${plural(c.trials, 'power-up')})`, color: k.color, dash: k.dash,
					values: pctOf(c.chasing), n: c.chasingN, emphasis: mine, faint: c.trials < ENOUGH,
					...(mine ? { lo: pctOf(c.chasingLo), hi: pctOf(c.chasingHi) } : {})
				};
			});
	});
	const options = CONDITIONS.map((c) => ({ value: c.id, label: `${c.code}. ${c.name}` }));
</script>

<div class="detail" use:inview={() => (seen = true)}>
	<div class="head">
		<Select size="sm" {options} bind:value={cue} aria-label="Condition" />
		<CueChip cue={cond} />
		{#if thin}<Badge tone="warn">Not enough data</Badge>{/if}
		<Button size="sm" variant="quiet" href="/play/{cue}">Play it</Button>
	</div>
	{#if info}<p class="desc">{info.description}</p>{/if}

	{#if !s || s.trials === 0}
		<EmptyState compact icon="chart" title="No power-ups for {cond.name} in this filter yet" />
	{:else}
		<div class="stats">
			<div class="rate" style:--c={RATE_COLOR.wellTimed}>
				<Stat label="Turned away in time" value={pct(s.wellTimed.rate)} interval="95% {pctRange(s.wellTimed.lo, s.wellTimed.hi)}"
					sub="{s.wellTimed.k} of {s.wellTimed.n} counted" delta={vs('wellTimed')} info="{DEFS.wellTimed} {DEFS.interval} {DEFS.paired}" />
			</div>
			<div class="rate" style:--c={RATE_COLOR.tooLate}>
				<Stat label="Too late" value={pct(s.tooLate.rate)} interval="95% {pctRange(s.tooLate.lo, s.tooLate.hi)}"
					sub="{s.tooLate.k} of {s.tooLate.n}; caught {s.caught.k} ({pct(s.caught.rate)}, 95% {pctRange(s.caught.lo, s.caught.hi)})" delta={vs('tooLate')} info="{DEFS.tooLate} {DEFS.caught}" />
			</div>
			<div class="rate" style:--c={RATE_COLOR.tooEarly}>
				<Stat label="Too early" value={pct(s.tooEarly.rate)} interval="95% {pctRange(s.tooEarly.lo, s.tooEarly.hi)}"
					sub="{s.tooEarly.k} of {s.tooEarly.n} counted" delta={vs('tooEarly')} info={DEFS.tooEarly} />
			</div>
			{#if s.gaveUpEarly}
				<Stat label="Gave up very early" value={pct(s.gaveUpEarly.k / Math.max(1, s.gaveUpEarly.n))} sub="{s.gaveUpEarly.k} of {s.gaveUpEarly.n} counted; part of too early" info={DEFS.gaveUpEarly} />
			{/if}
			<Stat label="Caught the ghost" value={pct(s.catches.share)} sub="{plural(s.catches.n, 'catch', 'catches')} of {s.inRates} eligible, {s.catches.late} late; in no rate" info={DEFS.catches} />
			<Stat label="Turn-away, median" value={s.turnAway.median === null ? null : s.turnAway.median.toFixed(2)} unit="s left"
				sub={s.turnAway.n ? `middle half ${s.turnAway.q25?.toFixed(1)} to ${s.turnAway.q75?.toFixed(1)} s, n ${s.turnAway.n}` : 'no turn-aways'} info={DEFS.turnAway} />
			<Stat label="Wasted power, mean" value={s.wasted.mean === null ? null : s.wasted.mean.toFixed(1)} unit="s"
				sub={plural(s.wasted.n, 'early retreat')} info={DEFS.wasted} />
			<Stat label="Clarity" value={rating?.clarity.mean == null ? null : rating.clarity.mean.toFixed(1)} unit="/ 7"
				sub={rating?.clarity.n ? `${plural(rating.clarity.n, 'answer')}, 95% ${rating.clarity.lo?.toFixed(1)}-${rating.clarity.hi?.toFixed(1)}` : ratings.data ? 'no answers yet' : 'loading'} info={DEFS.clarity} />
			<Stat label="Distraction" value={rating?.distraction.mean == null ? null : rating.distraction.mean.toFixed(1)} unit="/ 7"
				sub={rating?.distraction.n ? `${plural(rating.distraction.n, 'answer')}, 95% ${rating.distraction.lo?.toFixed(1)}-${rating.distraction.hi?.toFixed(1)}` : ratings.data ? 'no answers yet' : 'loading'} info={DEFS.distraction} />
		</div>
		<p class="basis">
			{plural(s.trials, 'power-up')} from {plural(s.participants, 'participant')}: {s.engaged} engaged, {s.decisions} counted
			(decisions, from {plural(s.decisionParticipants, 'participant')}), {plural(s.catches.n, 'catch', 'catches')} ({s.catches.late} late),
			{plural(s.nearMisses, 'near miss', 'near misses')}. Intervals: {s.interval === 'bootstrap' ? 'clustered by participant' : 'Wilson (under 3 people)'}.{#if s.oldRules}
				{plural(s.oldRules, 'power-up')} recorded before the current rules {s.oldRules === 1 ? 'is' : 'are'} not counted.{/if}
		</p>

		<h3>How its power-ups end</h3>
		<Legend label="Outcomes" items={OUTCOMES.map((o) => ({ label: o.label, color: o.color, kind: 'swatch', hatch: o.hatch }))} />
		<div class="gap"></div>
		<StackedBars
			rows={[{ id: cue, counts: s.outcomes }]}
			segments={OUTCOMES.map((o) => ({ id: o.id, label: o.label, color: o.color, hatch: o.hatch, def: o.def }))}
			caption="Outcomes of {cond.name}"
		>
			{#snippet label()}<span class="all">All power-ups</span>{/snippet}
		</StackedBars>

		<div class="two">
			<div>
				<h3>Every turn-away</h3>
				{#if points.data}
					<StripPlot
						rows={strip}
						domain={stripDomain}
						window={{ from: 2, to: 0.2, label: 'well timed' }}
						zero={{ label: 'power ends' }}
						xLabel="Seconds left when the player turned away"
						format={(v) => (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1))}
						names={false}
						rowHeight={72}
						extraLabel="never turned"
						caption="Turn-away times of {cond.name}"
					/>
				{:else}
					<p class="loading">Loading…</p>
				{/if}
			</div>
			<div>
				<h3>Still chasing as the power runs out, against the timer bar</h3>
				{#if lines.length}
					<LineChart
						x={approach.data!.bins}
						series={lines}
						xDomain={[approach.data!.window.from, approach.data!.window.to]}
						yDomain={[0, 100]}
						xLabel="Seconds of power left"
						yLabel="% chasing"
						xTicks={[4, 3, 2, 1, 0, -1, -2, -3]}
						xTitle={(v) => (v > 0 ? `${v} s left` : v === 0 ? 'Power ends' : `${-v} s after`)}
						yFormat={(v) => `${v.toFixed(0)}%`}
						window={{ from: 2, to: 0.2, label: 'well timed' }}
						markers={[{ at: 0, label: 'end' }]}
						minN={3}
						height={230}
						caption="Share still chasing under {cond.name} and the timer bar"
					/>
					<p class="foot">Power-ups of 4 s or more. Band: 95% interval.</p>
				{:else}
					<p class="loading">{approach.data ? 'No counted power-ups yet.' : 'Loading…'}</p>
				{/if}
			</div>
		</div>

		<h3>Latest power-ups</h3>
		<div class="flush">
			<Recent filter={cueFilter} {now} limit={12} hideCue maxHeight="320px" />
		</div>
	{/if}
</div>

<style>
	.detail {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		min-width: 0;
	}
	.detail > *,
	.two > * {
		min-width: 0;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.desc {
		max-width: 75ch;
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4) var(--space-5);
		margin-top: var(--space-2);
	}
	.basis,
	.foot {
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	/* The three rates carry their outcome colour (as in every chart) as a bar at the left. */
	.rate {
		padding-left: var(--space-3);
		border-left: 3px solid var(--c);
	}
	h3 {
		margin-top: var(--space-4);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 700;
	}
	.gap {
		height: 4px;
	}
	.all {
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-5);
	}
	.loading {
		padding: var(--space-5) 0;
		color: var(--ink-faint);
	}
	.flush {
		margin: 0 calc(-1 * var(--space-5));
	}
	@media (max-width: 860px) {
		.two,
		.stats {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
		.two {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 520px) {
		.flush {
			margin: 0 calc(-1 * var(--space-4));
		}
	}
</style>
