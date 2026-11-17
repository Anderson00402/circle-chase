<script lang="ts">
	/**
	 * The evidence behind the ranking. Each panel answers one question:
	 * - Outcome mix: how do power-ups end under each signal?
	 * - Turn-away times: when do players quit the chase, and is it inside the well-timed window?
	 * - Time to spare: at each turn-away, could the chase still have succeeded?
	 * - Wasted power: how much power do early quitters throw away?
	 * - Approach curves: how do players move as the power runs out?
	 * - Learning: do players get better with practice (and could practice explain a difference)?
	 * - Said vs did: do players who say a signal is clear also act well-timed with it?
	 * - Where the signal lives: does the place of the signal matter?
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { spread, wilson } from '#convex/lib/stats.ts';
	import type { CueChannel } from '#lib/game/types.ts';
	import { CueChip, EmptyState, InfoTip, Panel, Segmented } from '#lib/ui/index.ts';
	import DiffChart, { type DiffRow } from '#lib/charts/DiffChart.svelte';
	import ForestChart, { type ForestRow } from '#lib/charts/ForestChart.svelte';
	import Legend from '#lib/charts/Legend.svelte';
	import LineChart, { type LineSeries } from '#lib/charts/LineChart.svelte';
	import ScatterPlot, { type ScatterPoint } from '#lib/charts/ScatterPlot.svelte';
	import StackedBars from '#lib/charts/StackedBars.svelte';
	import StripPlot, { type StripRow } from '#lib/charts/StripPlot.svelte';
	import {
		CHANNEL_LABEL, EARLY_COLOR, LATE_COLOR, CONDITIONS, condition, OUTCOMES, outcomeStyle, pct, pctRange, plural, secs,
		WELL_COLOR, type Condition
	} from '#lib/charts/encoding.ts';
	import { outcomeLabel } from '#lib/outcomes.ts';
	import { DEFS, OUTCOME_ORDER_NOTE } from './defs';
	import { ENOUGH } from './insight';
	import { inview } from './inview';
	import QueryState from './QueryState.svelte';
	import { retrier } from './retry.svelte';
	import { orderedRows, takeOf } from './rows';
	import type { DashFilter, Main, RowOrder } from './types';
	import { slow } from '#lib/ui/index.ts';

	interface Props {
		main: Main;
		filter: DashFilter;
		order: RowOrder;
		selected: string | null;
		onselect: (id: string) => void;
	}
	let { main, filter, order = $bindable(), selected, onselect }: Props = $props();

	const rows = $derived(orderedRows(main.cues, order, takeOf(main).groups));

	// Outcome mix ---------------------------------------------------------------------------------
	let includeExcluded = $state(false);
	const segs = $derived(OUTCOMES.filter((o) => includeExcluded || o.inRates));
	// Counted (decision) power-ups only by default, so the green share is the well-timed rate, amber
	// plus red the too-late rate (red alone: caught) and violet the too-early rate; the switch shows
	// every power-up, including catches and the others outside the rates.
	const stackRows = $derived(rows.map((r) => ({
		id: r.cond.id,
		counts: (includeExcluded ? r.s?.outcomes : r.s?.countedOutcomes) ?? {},
		thin: r.thin,
		group: r.group
	})));

	// Turn-away and wasted power (one small row per trial, fetched when the panel is in view) ------
	let showPoints = $state(false);
	const pointsAgain = retrier();
	const points = useQuery(api.dashboard.points, () => (showPoints && !pointsAgain.paused ? { ...filter } : 'skip'));
	const pointsWait = slow(() => points.isLoading);
	let stripView = $state<'turn' | 'spare' | 'wasted'>('turn');
	type Pt = NonNullable<typeof points.data>[number];
	const pointOf = (p: Pt, v: number) => ({
		key: p.id,
		v,
		color: outcomeStyle(p.outcome).color,
		href: p.clip ? `/replays/${p.id}` : undefined,
		info: [
			stripView === 'turn'
				? ['Turned away', p.turnLeft === null ? 'never (still chasing at the end)' : `${p.turnLeft.toFixed(2)} s ${p.turnLeft >= 0 ? 'left' : 'after the end'}`]
				: stripView === 'spare'
					? ['Time to spare', p.spare === null ? '–' : `${p.spare > 0 ? '+' : ''}${p.spare.toFixed(2)} s (${p.spare >= 0 ? 'still had time for it' : 'could not have caught it'})`]
					: ['Power wasted', secs(p.wasted, 2)],
			...(stripView === 'spare' ? [['At the turn', `${p.turnLeft?.toFixed(2) ?? '–'} s left, ${p.turnDist?.toFixed(1) ?? '–'} tiles from the ghost`] as [string, string]] : []),
			['Outcome', outcomeLabel(p.outcome)],
			['Power length', secs(p.total)],
			['Participant', p.p !== null ? `P${p.p}, power-up ${p.trialIndex + 1}` : '–']
		] as [string, string][]
	});
	const pointRows = $derived.by((): StripRow[] => {
		const pts = points.data ?? [];
		const valOf = (p: Pt) => (stripView === 'turn' ? p.turnLeft : stripView === 'spare' ? p.spare : p.wasted);
		return rows.map((r) => {
			const mine = pts.filter((p) => p.cue === r.cond.id);
			const onAxis = mine.filter((p) => (stripView === 'wasted' ? p.wasted !== null : p.inRates && valOf(p) !== null));
			const never = stripView === 'turn' ? mine.filter((p) => p.inRates && p.turnLeft === null) : [];
			const vals = onAxis.map((p) => valOf(p)!);
			const sp = spread(vals);
			const had = vals.filter((v) => v >= 0).length;
			return {
				id: r.cond.id,
				cond: r.cond,
				thin: r.thin,
				group: r.group,
				median: sp.median,
				q25: sp.q25,
				q75: sp.q75,
				points: onAxis.map((p) => pointOf(p, valOf(p)!)),
				extra: never.map((p) => pointOf(p, 0)),
				...(stripView === 'spare' && vals.length ? { value: `${Math.round((had / vals.length) * 100)}% had time` } : {})
			};
		});
	});
	/** Axis fitted to the data, always showing the well-timed window and the end of the power. */
	const turnDomain = $derived.by((): [number, number] => {
		const vs = (points.data ?? []).filter((p) => p.inRates).map((p) => p.turnLeft).filter((v): v is number => v !== null);
		const hi = Math.max(2.5, Math.ceil(Math.max(0, ...vs) * 2) / 2);
		const lo = Math.min(-0.5, Math.floor(Math.min(0, ...vs) * 2) / 2);
		return [hi, lo];
	});
	const wastedDomain = $derived.by((): [number, number] => {
		const vs = (points.data ?? []).map((p) => p.wasted).filter((v): v is number => v !== null);
		return [0, Math.max(3, Math.ceil(Math.max(0, ...vs)))];
	});
	const neverCount = $derived(pointRows.reduce((a, r) => a + (r.extra?.length ?? 0), 0));
	/** Time to spare: axis around zero, and the share on each side over every turn-away. */
	const spareDomain = $derived.by((): [number, number] => {
		const vs = (points.data ?? []).filter((p) => p.inRates).map((p) => p.spare).filter((v): v is number => v !== null);
		const lo = Math.max(-6, Math.min(-2, Math.floor(Math.min(0, ...vs))));
		const hi = Math.min(6, Math.max(2, Math.ceil(Math.max(0, ...vs))));
		return [lo, hi];
	});
	const spareAll = $derived.by(() => {
		const vs = (points.data ?? []).filter((p) => p.inRates).map((p) => p.spare).filter((v): v is number => v !== null);
		const had = vs.filter((v) => v >= 0).length;
		return { n: vs.length, had, share: vs.length ? had / vs.length : null };
	});

	// Approach curves: small multiples, each condition against the timer bar ----------------------------
	let showApproach = $state(false);
	const approachAgain = retrier();
	const approach = useQuery(api.dashboard.approach, () => (showApproach && !approachAgain.paused ? { ...filter } : 'skip'));
	const approachWait = slow(() => approach.isLoading);
	let approachView = $state<'chasing' | 'dist'>('chasing');
	type ApproachCue = NonNullable<typeof approach.data>['cues'][number];
	const lineOf = (c: ApproachCue, emphasis: boolean): LineSeries => {
		const cond = condition(c.cue);
		const pctOf = (xs: (number | null)[]) => xs.map((v) => (v === null ? null : v * 100));
		return {
			id: c.cue,
			label: cond.code,
			name: `${cond.code}. ${cond.name} (${plural(c.trials, 'power-up')})`,
			color: cond.color,
			dash: cond.dash,
			values: approachView === 'dist' ? c.dist : pctOf(c.chasing),
			...(approachView === 'chasing' && emphasis ? { lo: pctOf(c.chasingLo), hi: pctOf(c.chasingHi) } : {}),
			n: approachView === 'dist' ? c.distN : c.chasingN,
			emphasis,
			faint: c.trials < ENOUGH
		};
	};
	const multiples = $derived.by(() => {
		const a = approach.data;
		if (!a) return [];
		const timer = a.cues.find((c) => c.cue === 'timer-bar') ?? null;
		const ids = order === 'code' ? CONDITIONS.map((c) => c.id) : orderedRows(main.cues, 'rank').map((r) => r.cond.id);
		return ids
			.filter((id) => id !== 'timer-bar')
			.map((id) => {
				const c = a.cues.find((x) => x.cue === id) ?? null;
				const series: LineSeries[] = [];
				// The timer bar at full strength (no band) so the comparison line is easy to follow.
				if (timer) series.push({ ...lineOf(timer, false), emphasis: true, faint: false });
				if (c) series.push(lineOf(c, true));
				return { id, cond: condition(id), c, series };
			});
	});
	const distMax = $derived(Math.max(6, ...(approach.data?.cues ?? []).flatMap((c) => c.dist.filter((v): v is number => v !== null))));
	const timerApproach = $derived(approach.data?.cues.find((c) => c.cue === 'timer-bar') ?? null);

	// Said vs did (questionnaire answers come from their own query) -----------------------------------
	let showRatings = $state(false);
	const ratingsAgain = retrier();
	const ratings = useQuery(api.dashboard.ratings, () => (showRatings && !ratingsAgain.paused ? { ...filter } : 'skip'));
	/** Ratings compared within people, against the timer bar. */
	let ratingKey = $state<'clarity' | 'distraction'>('clarity');
	const ratingDiffRows = $derived.by((): DiffRow[] => {
		const fam = ratings.data?.vsTimer[ratingKey] ?? [];
		const byId = new Map(fam.map((c) => [c.a, c]));
		const f2 = (x: number | null) => (x === null ? '–' : `${x > 0 ? '+' : ''}${x.toFixed(1)}`);
		return orderedRows(main.cues, order, takeOf(main).groups)
			.filter((r) => r.cond.id !== 'timer-bar')
			.map((r) => {
				const c = byId.get(r.cond.id);
				return {
					id: r.cond.id, cond: r.cond, group: r.group,
					diff: c?.diff ?? null, lo: c?.lo ?? null, hi: c?.hi ?? null, people: c?.people ?? 0, clear: !!c?.clear,
					thin: !c || c.lo === null,
					info: [
						[`${ratingKey === 'clarity' ? 'Clarity' : 'Distraction'} minus the timer bar`, f2(c?.diff ?? null)],
						['95% interval', c && c.lo !== null ? `${f2(c.lo)} to ${f2(c.hi)}` : 'needs 5 people'],
						['People who rated both', String(c?.people ?? 0)],
						['Verdict', c?.clear ? 'clear' : !c || c.p === null ? 'too few people to test' : 'could be chance']
					] as [string, string][]
				};
			});
	});
	const ratingSpan = $derived(Math.max(1, Math.ceil(Math.max(0, ...ratingDiffRows.flatMap((r) => [Math.abs(r.lo ?? 0), Math.abs(r.hi ?? 0), Math.abs(r.diff ?? 0)])))));

	// Learning ---------------------------------------------------------------------------------------
	function learningSeries(b: Main['learning']['byTrial']): LineSeries[] {
		return [
			{
				id: 'well', label: 'In time', name: 'Turned away in time', color: WELL_COLOR, dots: true,
				values: b.map((x) => (x.n ? x.wellTimed.rate! * 100 : null)),
				lo: b.map((x) => (x.n ? x.wellTimed.lo! * 100 : null)), hi: b.map((x) => (x.n ? x.wellTimed.hi! * 100 : null)),
				n: b.map((x) => x.n)
			},
			{
				id: 'late', label: 'Too late', name: 'Too-late rate', color: LATE_COLOR, dots: true,
				values: b.map((x) => (x.n ? x.tooLate.rate! * 100 : null)),
				lo: b.map((x) => (x.n ? x.tooLate.lo! * 100 : null)), hi: b.map((x) => (x.n ? x.tooLate.hi! * 100 : null)),
				n: b.map((x) => x.n)
			},
			{
				id: 'early', label: 'Too early', name: 'Too-early rate', color: EARLY_COLOR, dots: true,
				values: b.map((x) => (x.n ? x.tooEarly.rate! * 100 : null)),
				lo: b.map((x) => (x.n ? x.tooEarly.lo! * 100 : null)), hi: b.map((x) => (x.n ? x.tooEarly.hi! * 100 : null)),
				n: b.map((x) => x.n)
			}
		];
	}
	const byTrial = $derived(main.learning.byTrial);
	const byBlock = $derived(main.learning.byBlock);

	// Said vs did ------------------------------------------------------------------------------------
	function ratingPoints(key: 'clarity' | 'distraction'): ScatterPoint[] {
		const byCue = new Map((ratings.data?.cues ?? []).map((r) => [r.cue, r]));
		return main.cues
			.filter((c) => (byCue.get(c.cue)?.[key].n ?? 0) > 0 && c.wellTimed.rate !== null)
			.map((c) => {
				const cond = condition(c.cue);
				const r = byCue.get(c.cue)![key];
				return {
					id: c.cue, label: cond.code, name: cond.name, x: r.mean!, y: c.wellTimed.rate! * 100,
					xlo: r.lo, xhi: r.hi, ylo: c.wellTimed.lo! * 100, yhi: c.wellTimed.hi! * 100,
					color: cond.color, shape: cond.shape, thin: c.decisions < ENOUGH,
					info: [
						[key === 'clarity' ? 'Clarity' : 'Distraction', `${r.mean!.toFixed(1)} of 7 (${plural(r.n, 'answer')})`],
						['Turned away in time', `${pct(c.wellTimed.rate)} of ${c.wellTimed.n}`],
						['95% interval', pctRange(c.wellTimed.lo, c.wellTimed.hi)]
					] as [string, string][]
				};
			});
	}
	const clarityPts = $derived(ratingPoints('clarity'));
	const distractPts = $derived(ratingPoints('distraction'));

	// Where the signal lives -------------------------------------------------------------------------
	const CHANNELS: CueChannel[] = ['hud', 'ghosts', 'player', 'maze', 'screen'];
	const channelRows = $derived.by((): ForestRow[] => {
		return CHANNELS.map((ch) => {
			const members = CONDITIONS.filter((c) => c.channel === ch && c.id !== 'none');
			const ss = members.map((m) => main.cues.find((c) => c.cue === m.id)).filter((s) => !!s);
			const n = ss.reduce((a, s) => a + s.wellTimed.n, 0);
			const well = ss.reduce((a, s) => a + s.wellTimed.k, 0);
			const late = ss.reduce((a, s) => a + s.tooLate.k, 0);
			const early = ss.reduce((a, s) => a + s.tooEarly.k, 0);
			const pseudo: Condition = {
				id: ch, code: '', name: CHANNEL_LABEL[ch], role: 'idea', channel: ch, order: 0,
				color: 'var(--ink-dim)', shape: 'circle', dash: undefined
			};
			return {
				id: ch, cond: pseudo, thin: n < ENOUGH,
				values: { wellTimed: wilson(well, n), tooLate: wilson(late, n), tooEarly: wilson(early, n) },
				note: `Conditions: ${members.map((m) => `${m.code} ${m.name}`).join(', ')}`
			};
		});
	});
	const noneRef = $derived.by(() => {
		const s = main.cues.find((c) => c.cue === 'none');
		if (!s || s.decisions < ENOUGH) return { wellTimed: [], tooLate: [], tooEarly: [] };
		const c = condition('none');
		const ref = (v: number | null) => (v === null ? [] : [{ id: 'none', code: c.code, name: c.name, value: v, color: c.color, dash: c.dash }]);
		return { wellTimed: ref(s.wellTimed.rate), tooLate: ref(s.tooLate.rate), tooEarly: ref(s.tooEarly.rate) };
	});
</script>

<section class="why" aria-labelledby="why-h">
	<header class="sec-head">
		<div>
			<p class="eyebrow">Why</p>
			<h2 id="why-h">The evidence behind the ranking</h2>
		</div>
		<div class="order">
			<span class="order-label">Row order</span>
			<Segmented
				label="Row order"
				size="sm"
				options={[{ value: 'rank', label: 'By rank' }, { value: 'code', label: 'By code' }]}
				bind:value={order}
			/>
		</div>
	</header>

	<Panel
		title="How power-ups end"
		sub={includeExcluded
			? 'Every power-up, including those outside the rates (grey): catches, other, not engaged, interrupted.'
			: 'Counted power-ups (decisions), left to right from turning away too early to being caught. Green is the well-timed rate, amber and red together the too-late rate, violet the too-early rate.'}
	>
		{#snippet actions()}
			<label class="check"><input type="checkbox" bind:checked={includeExcluded} /> Show power-ups outside the rates</label>
			<InfoTip term="Outcome" align="end">{OUTCOME_ORDER_NOTE}</InfoTip>
		{/snippet}
		<div class="legend-row">
			<Legend label="Outcomes" items={segs.map((o) => ({ label: o.label, color: o.color, kind: 'swatch', hatch: o.hatch }))} />
		</div>
		<StackedBars
			rows={stackRows}
			segments={segs.map((o) => ({ id: o.id, label: o.label, color: o.color, hatch: o.hatch, def: o.def }))}
			caption="Outcome counts per condition"
			noun={includeExcluded ? 'power-ups' : 'counted power-ups'}
			{selected}
			{onselect}
		>
			{#snippet label(row)}<CueChip cue={condition(row.id)} size="sm" />{/snippet}
		</StackedBars>
	</Panel>

	<div use:inview={() => (showPoints = true)}>
		<Panel
			title={stripView === 'turn' ? 'When players quit the chase' : stripView === 'spare' ? 'Could the chase still have succeeded?' : 'Power thrown away'}
			sub={stripView === 'turn'
				? 'Every counted power-up is a dot, coloured by its outcome. Box: middle half. Tick: median. Never turned: still chasing when the power ended. Click a dot for its replay.'
				: stripView === 'spare'
					? 'Every turn-away (in time or too early) is a dot: the power left minus the time the pursuit still needed to reach the ghost. Right of zero the player still had time for that ghost; left of zero the chase could not have reached it in time.'
					: 'Seconds of power left after each early retreat. Box: middle half. Tick: median.'}
		>
			{#snippet actions()}
				<Segmented
					label="Measure"
					size="sm"
					options={[{ value: 'turn', label: 'Turn-away time' }, { value: 'spare', label: 'Time to spare' }, { value: 'wasted', label: 'Wasted power' }]}
					bind:value={stripView}
				/>
				<InfoTip term={stripView === 'turn' ? 'Turn-away time' : stripView === 'spare' ? 'Time to spare' : 'Wasted power'} align="end">
					{stripView === 'turn' ? `${DEFS.turnAway} ${DEFS.neverTurned}` : stripView === 'spare' ? DEFS.timeToSpare : DEFS.wasted}
				</InfoTip>
			{/snippet}
			{#if !points.data}
				<QueryState error={points.error} wait={pointsWait} what="every power-up" onretry={pointsAgain.retry} tall />
			{:else if !points.data.some((p) => (stripView === 'wasted' ? p.wasted !== null : stripView === 'spare' ? p.inRates && p.spare !== null : p.inRates))}
				<EmptyState compact icon="chart" title={stripView === 'wasted' ? 'No early retreats yet' : stripView === 'spare' ? 'No turn-aways with a distance yet' : 'No counted power-ups yet'}>
					{stripView === 'wasted'
						? 'Wasted power is measured on early retreats.'
						: stripView === 'spare'
							? 'Time to spare needs turn-aways (in time or too early) whose distance to the ghost was stored.'
							: 'They appear once players chase scared ghosts near the end of a power-up.'}
				</EmptyState>
			{:else}
				<div class="legend-row">
					<Legend
						label="Outcomes"
						items={OUTCOMES.filter((o) => o.inRates).map((o) => ({ label: o.label, color: o.color, kind: 'swatch' }))}
					/>
				</div>
				{#if stripView === 'turn'}
					<StripPlot
						rows={pointRows}
						domain={turnDomain}
						window={{ from: 2, to: 0.2, label: 'well timed: 2 to 0.2 s left' }}
						zero={{ label: 'power ends' }}
						xLabel="Seconds of power left when the player turned away (negative: after the end)"
						ends={['quit early', 'too late']}
						format={(v) => (v === 0 ? '0' : Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1))}
						rowHeight={46}
						extraLabel="never turned"
						caption="Turn-away time of every counted power-up per condition, with those that never turned in their own column"
					/>
					<p class="foot">{plural(neverCount, 'counted power-up')} never turned away (the column at the right).</p>
				{:else if stripView === 'spare'}
					<StripPlot
						rows={pointRows}
						domain={spareDomain}
						zero={{ label: 'just enough time' }}
						xLabel="Seconds to spare at the turn-away: power left minus the time the pursuit still needed"
						ends={['could not have caught it', 'still had time for it']}
						format={(v) => (v === 0 ? '0' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`)}
						rowHeight={40}
						caption="Time to spare at every turn-away per condition"
					/>
					<p class="foot">
						Over every turn-away here, {spareAll.share === null ? '–' : `${Math.round(spareAll.share * 100)}%`} still had time for the
						ghost ({spareAll.had} of {spareAll.n}) and {spareAll.share === null ? '–' : `${Math.round((1 - spareAll.share) * 100)}%`} could
						not have caught it. A turn-away left of zero that counts as "too early" broke off a chase that could not succeed: a
						judgement of the chase, not of the clock. Right column: the share that still had time, per condition.
					</p>
				{:else}
					<StripPlot
						rows={pointRows}
						domain={wastedDomain}
						xLabel="Seconds of power wasted"
						format={(v) => v.toFixed(0)}
						rowHeight={40}
						caption="Wasted power after every early retreat per condition"
					/>
				{/if}
			{/if}
		</Panel>
	</div>

	<div use:inview={() => (showApproach = true)}>
		<Panel
			title={approachView === 'chasing' ? 'Who is still chasing as the power runs out' : 'How close players stay as the power runs out'}
			sub={approachView === 'chasing'
				? 'Each condition against the timer bar (blue), same axes. Share of counted power-ups still closing in on a ghost; band: 95% interval. A good signal makes the line drop inside the green window, before 0.'
				: 'Each condition against the timer bar (blue), same axes. Median path distance to the nearest scared ghost. Players who read the signal pull away before 0.'}
		>
			{#snippet actions()}
				<Segmented
					label="Approach measure"
					size="sm"
					options={[{ value: 'chasing', label: 'Still chasing' }, { value: 'dist', label: 'Distance' }]}
					bind:value={approachView}
				/>
				<InfoTip term="Approach curves" align="end">{approachView === 'dist' ? DEFS.approach : DEFS.stillChasing}</InfoTip>
			{/snippet}
			{#if !approach.data}
				<QueryState error={approach.error} wait={approachWait} what="the approach curves" onretry={approachAgain.retry} tall />
			{:else if !approach.data.cues.length}
				<EmptyState compact icon="chart" title="No counted power-ups yet">The curves need counted power-ups.</EmptyState>
			{:else}
				<p class="basis-note">
					Only power-ups that lasted at least {approach.data.window.from} s, so every point of a curve rests on the same power-ups.
					{#if approach.data.excluded.short}{plural(approach.data.excluded.short, 'shorter counted power-up')} left out.{/if}
					{#if timerApproach}Timer bar: {plural(timerApproach.trials, 'power-up')} from {plural(timerApproach.people, 'person', 'people')}.{/if}
				</p>
				<div class="multiples">
					{#each multiples as m (m.id)}
						<figure class="mini" class:thin={!m.c || m.c.trials < ENOUGH}>
							<figcaption>
								<CueChip cue={m.cond} size="sm" compact />
								<span class="mini-name">{m.cond.name}</span>
								<span class="mini-n">{m.c ? `n ${m.c.trials}, ${m.c.people} ${m.c.people === 1 ? 'person' : 'people'}` : 'no data'}</span>
							</figcaption>
							{#if m.c}
								<LineChart
									x={approach.data.bins}
									series={m.series}
									xDomain={[approach.data.window.from, approach.data.window.to]}
									yDomain={approachView === 'dist' ? [0, Math.ceil(distMax)] : [0, 100]}
									xLabel="Seconds left"
									yLabel={approachView === 'dist' ? 'Tiles' : '% chasing'}
									xFormat={(v) => String(v)}
									yFormat={(v) => (approachView === 'dist' ? v.toFixed(0) : `${v.toFixed(0)}%`)}
									xTitle={(v) => (v > 0 ? `${v} s left` : v === 0 ? 'Power ends' : `${-v} s after the end`)}
									xTicks={[4, 2, 0, -2]}
									window={{ from: 2, to: 0.2, label: '' }}
									markers={[{ at: 0, label: '' }]}
									minN={3}
									height={170}
									endLabels={false}
									caption="{m.cond.name} against the timer bar"
								/>
							{:else}
								<p class="mini-empty">No counted power-ups of 4 s or more yet.</p>
							{/if}
						</figure>
					{/each}
				</div>
				<p class="foot">Faint panels: under {ENOUGH} counted power-ups. Hover a panel for the values and n at each moment.</p>
			{/if}
		</Panel>
	</div>

	<div class="two">
		<Panel title="Practice within a run" sub="All conditions together, by power-up number within its run.">
			{#snippet actions()}<InfoTip term="Learning" align="end">{DEFS.learning}</InfoTip>{/snippet}
			{#if byTrial.some((b) => b.n > 0)}
				<LineChart
					x={byTrial.map((b) => b.x)}
					series={learningSeries(byTrial)}
					xDomain={[1, main.learning.maxTrialBucket]}
					yDomain={[0, 100]}
					xLabel="Power-up number within the run"
					yLabel="% of counted"
					xFormat={(v) => (v === main.learning.maxTrialBucket ? `${v}+` : String(v))}
					yFormat={(v) => `${v.toFixed(0)}%`}
					xTitle={(v) => `Power-up ${v}${v === main.learning.maxTrialBucket ? ' and later' : ''}`}
					xTicks={byTrial.map((b) => b.x)}
					height={240}
					minN={10}
					caption="Turned away in time, too late and too early by power-up number within a run"
				/>
				<p class="foot">Bands: 95% Wilson intervals (pooled over people). Points with fewer than 10 counted power-ups are not drawn; n per point in the tooltip.</p>
			{:else}
				<EmptyState compact icon="chart" title="No counted power-ups yet" />
			{/if}
		</Panel>
		<Panel title="Practice across the session" sub="All conditions together, by run position in the session (1 = first condition played).">
			{#snippet actions()}<InfoTip term="Learning" align="end">{DEFS.learning}</InfoTip>{/snippet}
			{#if byBlock.length > 1 && byBlock.some((b) => b.n > 0)}
				<LineChart
					x={byBlock.map((b) => b.x)}
					series={learningSeries(byBlock)}
					xDomain={[1, Math.max(2, byBlock.length)]}
					yDomain={[0, 100]}
					xLabel="Run position in the session"
					yLabel="% of counted"
					yFormat={(v) => `${v.toFixed(0)}%`}
					xTitle={(v) => `Run ${v} of the session`}
					xTicks={byBlock.map((b) => b.x)}
					height={240}
					minN={10}
					caption="Turned away in time, too late and too early by run position in the session"
				/>
				<p class="foot">The counterbalanced order spreads practice evenly over the conditions.</p>
			{:else}
				<EmptyState compact icon="chart" title={byBlock.length > 1 ? 'No counted power-ups yet' : 'Needs sessions with more than one run'}>A full session plays one run per condition.</EmptyState>
			{/if}
		</Panel>
	</div>

	<div class="two" use:inview={() => (showRatings = true)}>
		<Panel title="Felt clear vs turned away in time" sub="Each point is a condition: questionnaire clarity against how often players turned away in time.">
			{#snippet actions()}<InfoTip term="Clarity" align="end">{DEFS.clarity}</InfoTip>{/snippet}
			{#if clarityPts.length}
				<ScatterPlot
					points={clarityPts}
					xDomain={[1, 7]}
					yDomain={[0, 100]}
					xLabel="Clarity rating (1-7)"
					xEnds={['unclear', 'clear']}
					yLabel="% in time"
					yFormat={(v) => `${v.toFixed(0)}%`}
					caption="Clarity rating against turned away in time per condition"
				/>
				<p class="foot">Whiskers: 95% intervals. If players' sense of clarity matched their play, points would rise to the right.</p>
			{:else}
				{#if ratings.data}
					<EmptyState compact icon="study" title="No questionnaire answers in this view yet">After each run the researcher can ask the two questions (1 to 7); answers show up here.</EmptyState>
				{:else}
					<QueryState error={ratings.error} wait={{ offline: false, late: false }} what="the answers" onretry={ratingsAgain.retry} />
				{/if}
			{/if}
		</Panel>
		<Panel title="Felt distracting vs turned away in time" sub="Questionnaire distraction against how often players turned away in time.">
			{#snippet actions()}<InfoTip term="Distraction" align="end">{DEFS.distraction}</InfoTip>{/snippet}
			{#if distractPts.length}
				<ScatterPlot
					points={distractPts}
					xDomain={[1, 7]}
					yDomain={[0, 100]}
					xLabel="Distraction rating (1-7)"
					xEnds={['not at all', 'very']}
					yLabel="% in time"
					yFormat={(v) => `${v.toFixed(0)}%`}
					caption="Distraction rating against turned away in time per condition"
				/>
				<p class="foot">The ideal signal sits top left: turned away in time and not in the way.</p>
			{:else if ratings.data}
				<EmptyState compact icon="study" title="No questionnaire answers in this view yet" />
			{:else}
				<QueryState error={ratings.error} wait={{ offline: false, late: false }} what="the answers" onretry={ratingsAgain.retry} />
			{/if}
		</Panel>
	</div>

	{#if ratings.data && ratings.data.cues.length}
		<Panel
			title="Ratings against the timer bar, person by person"
			sub="For everyone who rated both, their rating of the condition minus their rating of the timer bar (1 to 7 scale), averaged over those people. Bars: 95% intervals over people."
		>
			{#snippet actions()}
				<div class="ctl-row">
					<Segmented label="Question" size="sm" options={[{ value: 'clarity', label: 'Clarity' }, { value: 'distraction', label: 'Distraction' }]} bind:value={ratingKey} />
					<InfoTip term="Ratings within people" align="end">{DEFS.ratingsPaired}</InfoTip>
				</div>
			{/snippet}
			{#if ratingDiffRows.some((r) => r.people > 0)}
				<DiffChart
					rows={ratingDiffRows}
					span={ratingSpan}
					ends={ratingKey === 'clarity' ? ['less clear', 'clearer'] : ['less in the way', 'more in the way']}
					zeroLabel="rated like the timer bar"
					scale={1}
					unit=""
					decimals={1}
					{selected}
					{onselect}
					caption="{ratingKey === 'clarity' ? 'Clarity' : 'Distraction'} rating minus the timer bar's, per condition, with 95% intervals over people"
				>
					{#snippet label(row)}<CueChip cue={row.cond} size="sm" />{/snippet}
				</DiffChart>
				<p class="foot">Hollow points: fewer than 5 people rated both, so there is no interval or test. Clear means the difference survives Holm's adjustment over the conditions compared.</p>
			{:else}
				<EmptyState compact icon="study" title="Nobody has rated the timer bar and another condition yet" />
			{/if}
		</Panel>
	{/if}

	<Panel title="Where the signal lives" sub="Conditions pooled by where the signal is shown, with Wilson intervals. No signal (A) is the yardstick line.">
		{#snippet actions()}<InfoTip term="Channel" align="end">{DEFS.channel}</InfoTip>{/snippet}
		<ForestChart
			rows={channelRows}
			columns={[
				{ key: 'wellTimed', title: 'Turned away in time', better: 'higher', refs: noneRef.wellTimed },
				{ key: 'tooLate', title: 'Too late', better: 'lower', refs: noneRef.tooLate },
				{ key: 'tooEarly', title: 'Too early', better: 'lower', refs: noneRef.tooEarly }
			]}
			caption="Turned away in time, too late and too early pooled by where the signal is shown"
		>
			{#snippet label(row)}
				<span class="ch">
					<span class="ch-name">{row.cond.name}</span>
					<span class="ch-codes">
						{#each CONDITIONS.filter((c) => c.channel === row.id && c.id !== 'none') as c (c.id)}
							<CueChip cue={c} compact size="sm" />
						{/each}
					</span>
				</span>
			{/snippet}
		</ForestChart>
		<p class="foot">Pooled rates treat every power-up alike; a group with one strong and one weak signal can look average.</p>
	</Panel>
</section>

<style>
	.why {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
	}
	.two > * {
		min-width: 0;
	}
	.ctl-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.sec-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.sec-head h2 {
		font-size: var(--text-xl);
	}
	.order {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.order-label {
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.legend-row {
		margin-bottom: var(--space-3);
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ink-dim);
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.check input {
		accent-color: var(--accent);
	}
	.two {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-5);
	}
	.basis-note {
		margin-bottom: var(--space-3);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.multiples {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-4) var(--space-5);
	}
	.mini {
		min-width: 0;
		margin: 0;
	}
	.mini.thin {
		opacity: 0.6;
	}
	.mini figcaption {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 2px;
		font-size: var(--text-sm);
	}
	.mini-name {
		overflow: hidden;
		color: var(--ink);
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mini-n {
		margin-left: auto;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.mini-empty {
		padding: var(--space-5) 0;
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}
	.foot {
		margin-top: var(--space-2);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.ch {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.ch-name {
		font-size: var(--text-sm);
		font-weight: 650;
	}
	.ch-codes {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	@media (max-width: 860px) {
		.two {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
