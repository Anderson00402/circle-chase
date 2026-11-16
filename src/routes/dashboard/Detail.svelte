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
	import LineChart, { type LineSeries } from '#lib/charts/LineChart.svelte';
	import StackedBars from '#lib/charts/StackedBars.svelte';
	import StripPlot from '#lib/charts/StripPlot.svelte';
	import Legend from '#lib/charts/Legend.svelte';
	import {
		CONDITIONS, condition, OUTCOMES, outcomeStyle, pct, pctRange, plural, secs, YARDSTICKS
	} from '#lib/charts/encoding.ts';
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
	const yard = (id: string) => main.cues.find((c) => c.cue === id && c.decisions >= ENOUGH) ?? null;

	function vs(key: 'wellTimed' | 'tooLate' | 'tooEarly'): string | undefined {
		if (!s || s[key].rate === null) return undefined;
		const parts = YARDSTICKS.filter((y) => y !== cue).map((y) => {
			const r = yard(y);
			if (!r || r[key].rate === null) return null;
			const d = Math.round((s[key].rate! - r[key].rate!) * 100);
			return `${d >= 0 ? '+' : ''}${d} vs ${condition(y).code}`;
		}).filter(Boolean);
		return parts.length ? `${parts.join(', ')} (points)` : undefined;
	}

	let seen = $state(false);
	const cueFilter = $derived({ ...filter, cue });
	const points = useQuery(api.dashboard.points, () => (seen ? cueFilter : 'skip'));
	// Approach curves for this condition and the yardsticks (one query over the filter; the server
	// returns only per-condition averages).
	const approach = useQuery(api.dashboard.approach, () => (seen ? { ...filter } : 'skip'));

	const strip = $derived.by(() => {
		const pts = (points.data ?? []).filter((p) => p.turnLeft !== null);
		const sp = spread(pts.map((p) => p.turnLeft!));
		return [{
			id: cue, cond, thin, median: sp.median, q25: sp.q25, q75: sp.q75,
			points: pts.map((p) => ({
				key: p.id, v: p.turnLeft!, color: outcomeStyle(p.outcome).color,
				href: p.clip ? `/replays/${p.id}` : undefined,
				info: [
					['Turned away', `${p.turnLeft!.toFixed(2)} s left`], ['Outcome', outcomeStyle(p.outcome).label],
					['Power length', secs(p.total)], ['Participant', p.p !== null ? `P${p.p}, power-up ${p.trialIndex + 1}` : '–']
				] as [string, string][]
			}))
		}];
	});
	const lines = $derived.by((): LineSeries[] => {
		const a = approach.data;
		if (!a) return [];
		return a.cues
			.filter((c) => c.cue === cue || (YARDSTICKS as readonly string[]).includes(c.cue))
			.map((c) => {
				const k = condition(c.cue);
				return {
					id: c.cue, label: k.code, name: `${k.code}. ${k.name}`, color: k.color, dash: k.dash,
					values: c.dist, n: c.distN, emphasis: c.cue === cue, faint: c.trials < ENOUGH
				};
			});
	});
	const distMax = $derived(Math.max(6, ...lines.flatMap((l) => l.values.filter((v): v is number => v !== null))));
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
			<Stat label="Turned away in time" value={pct(s.wellTimed.rate)} interval="95% {pctRange(s.wellTimed.lo, s.wellTimed.hi)}"
				sub="{s.wellTimed.k} of {s.wellTimed.n} counted" delta={vs('wellTimed')} info="{DEFS.wellTimed} {DEFS.interval}" tone={thin ? 'ink' : 'good'} />
			<Stat label="Too late" value={pct(s.tooLate.rate)} interval="95% {pctRange(s.tooLate.lo, s.tooLate.hi)}"
				sub="{s.tooLate.k} of {s.tooLate.n}; caught {s.caught.k} ({pct(s.caught.rate)}, 95% {pctRange(s.caught.lo, s.caught.hi)})" delta={vs('tooLate')} info="{DEFS.tooLate} {DEFS.caught}" tone={thin ? 'ink' : 'bad'} />
			<Stat label="Too early" value={pct(s.tooEarly.rate)} interval="95% {pctRange(s.tooEarly.lo, s.tooEarly.hi)}"
				sub="{s.tooEarly.k} of {s.tooEarly.n} counted" delta={vs('tooEarly')} info={DEFS.tooEarly} tone={thin ? 'ink' : 'warn'} />
			<Stat label="Caught the ghost" value={pct(s.catches.share)} sub="{plural(s.catches.n, 'catch', 'catches')} of {s.inRates} engaged, {s.catches.late} late; in no rate" info={DEFS.catches} />
			<Stat label="Turn-away, median" value={s.turnAway.median === null ? null : s.turnAway.median.toFixed(2)} unit="s left"
				sub={s.turnAway.n ? `middle half ${s.turnAway.q25?.toFixed(1)} to ${s.turnAway.q75?.toFixed(1)} s, n ${s.turnAway.n}` : 'no turn-aways'} info={DEFS.turnAway} />
			<Stat label="Wasted power, mean" value={s.wasted.mean === null ? null : s.wasted.mean.toFixed(1)} unit="s"
				sub={plural(s.wasted.n, 'early retreat')} info={DEFS.wasted} />
			<Stat label="Clarity" value={s.clarityCI.mean === null ? null : s.clarityCI.mean.toFixed(1)} unit="/ 7"
				sub={s.clarityCI.n ? `${plural(s.clarityCI.n, 'answer')}, 95% ${s.clarityCI.lo?.toFixed(1)}-${s.clarityCI.hi?.toFixed(1)}` : 'no answers yet'} info={DEFS.clarity} />
			<Stat label="Distraction" value={s.distractionCI.mean === null ? null : s.distractionCI.mean.toFixed(1)} unit="/ 7"
				sub={s.distractionCI.n ? `${plural(s.distractionCI.n, 'answer')}, 95% ${s.distractionCI.lo?.toFixed(1)}-${s.distractionCI.hi?.toFixed(1)}` : 'no answers yet'} info={DEFS.distraction} />
		</div>
		<p class="basis">
			{plural(s.trials, 'power-up')} from {plural(s.participants, 'participant')}: {s.engaged} engaged, {s.decisions} counted
			(decisions, from {plural(s.decisionParticipants, 'participant')}), {plural(s.catches.n, 'catch', 'catches')} ({s.catches.late} late),
			{plural(s.nearMisses, 'near miss', 'near misses')}. Intervals: {s.interval === 'bootstrap' ? 'clustered by participant' : 'Wilson (under 3 people)'}.{#if s.oldRules}
				{plural(s.oldRules, 'power-up')} scored by older rules {s.oldRules === 1 ? 'is' : 'are'} left out.{/if}
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
						domain={[Math.max(6, Math.ceil(Math.max(0, ...strip[0].points.map((p) => p.v)))), -2]}
						window={{ from: 2, to: 0.2, label: 'well timed' }}
						zero={{ label: 'power ends' }}
						xLabel="Seconds left when the player turned away"
						format={(v) => v.toFixed(0)}
						names={false}
						rowHeight={64}
						caption="Turn-away times of {cond.name}"
					/>
				{:else}
					<p class="loading">Loading…</p>
				{/if}
			</div>
			<div>
				<h3>Distance to the ghost, against the yardsticks</h3>
				{#if lines.length}
					<LineChart
						x={approach.data!.bins}
						series={lines}
						xDomain={[6, -3]}
						yDomain={[0, Math.ceil(distMax)]}
						xLabel="Seconds of power left"
						yLabel="Tiles"
						xTicks={[6, 4, 2, 0, -2]}
						xTitle={(v) => (v > 0 ? `${v} s left` : v === 0 ? 'Power ends' : `${-v} s after`)}
						yFormat={(v) => v.toFixed(0)}
						window={{ from: 2, to: 0.2, label: 'well timed' }}
						markers={[{ at: 0, label: 'end' }]}
						minN={3}
						height={230}
						caption="Approach curve of {cond.name} with the yardsticks"
					/>
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
	.basis {
		color: var(--ink-faint);
		font-size: var(--text-xs);
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
