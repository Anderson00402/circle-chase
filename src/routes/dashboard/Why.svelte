<script lang="ts">
	/**
	 * The evidence behind the ranking. Each panel answers one question:
	 * - Outcome mix: how do power-ups end under each signal?
	 * - Turn-away times: when do players quit the chase, and is it inside the well-timed window?
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
	import { CueChip, EmptyState, InfoTip, Panel, Segmented, Select } from '#lib/ui/index.ts';
	import ForestChart, { type ForestRow } from '#lib/charts/ForestChart.svelte';
	import Legend from '#lib/charts/Legend.svelte';
	import LineChart, { type LineSeries } from '#lib/charts/LineChart.svelte';
	import ScatterPlot, { type ScatterPoint } from '#lib/charts/ScatterPlot.svelte';
	import StackedBars from '#lib/charts/StackedBars.svelte';
	import StripPlot, { type StripRow } from '#lib/charts/StripPlot.svelte';
	import {
		CAUGHT_COLOR, CHANNEL_LABEL, CONDITIONS, condition, OUTCOMES, outcomeStyle, pct, pctRange, plural, ROLE_COLOR,
		secs, WELL_COLOR, YARDSTICKS, type Condition
	} from '#lib/charts/encoding.ts';
	import { DEFS, OUTCOME_ORDER_NOTE } from './defs';
	import { ENOUGH } from './insight';
	import { inview } from './inview';
	import { orderedRows } from './rows';
	import type { DashFilter, Main, RowOrder } from './types';

	interface Props {
		main: Main;
		filter: DashFilter;
		order: RowOrder;
		selected: string | null;
		onselect: (id: string) => void;
	}
	let { main, filter, order = $bindable(), selected, onselect }: Props = $props();

	const rows = $derived(orderedRows(main.cues, order));

	// Outcome mix ---------------------------------------------------------------------------------
	let includeExcluded = $state(false);
	const segs = $derived(OUTCOMES.filter((o) => includeExcluded || o.inRates));
	// Counted power-ups only by default, so the red share is the caught rate and the green share
	// the well-timed rate; the switch shows every power-up, including those outside the rates.
	const stackRows = $derived(rows.map((r) => ({
		id: r.cond.id,
		counts: (includeExcluded ? r.s?.outcomes : r.s?.countedOutcomes) ?? {},
		thin: r.thin,
		group: r.group
	})));

	// Turn-away and wasted power (one small row per trial, fetched when the panel is in view) ------
	let showPoints = $state(false);
	const points = useQuery(api.dashboard.points, () => (showPoints ? { ...filter } : 'skip'));
	let stripView = $state<'turn' | 'wasted'>('turn');
	const pointRows = $derived.by((): StripRow[] => {
		const pts = points.data ?? [];
		return rows.map((r) => {
			const mine = pts.filter((p) => p.cue === r.cond.id && (stripView === 'turn' ? p.turnLeft !== null : p.wasted !== null));
			const vals = mine.map((p) => (stripView === 'turn' ? p.turnLeft! : p.wasted!));
			const sp = spread(vals);
			return {
				id: r.cond.id,
				cond: r.cond,
				thin: r.thin,
				group: r.group,
				median: sp.median,
				q25: sp.q25,
				q75: sp.q75,
				points: mine.map((p) => ({
					key: p.id,
					v: stripView === 'turn' ? p.turnLeft! : p.wasted!,
					color: outcomeStyle(p.outcome).color,
					href: p.clip ? `/replays/${p.id}` : undefined,
					info: [
						[stripView === 'turn' ? 'Turned away' : 'Power wasted', stripView === 'turn' ? `${p.turnLeft!.toFixed(2)} s left` : secs(p.wasted, 2)],
						['Outcome', outcomeStyle(p.outcome).label],
						['Power length', secs(p.total)],
						['Participant', p.p !== null ? `P${p.p}, power-up ${p.trialIndex + 1}` : '–']
					] as [string, string][]
				}))
			};
		});
	});
	const turnDomain = $derived.by((): [number, number] => {
		const vs = (points.data ?? []).map((p) => p.turnLeft).filter((v): v is number => v !== null);
		const hi = Math.max(6, Math.ceil(Math.max(0, ...vs)));
		const lo = Math.min(-2, Math.floor(Math.min(0, ...vs)));
		return [hi, lo];
	});
	const wastedDomain = $derived.by((): [number, number] => {
		const vs = (points.data ?? []).map((p) => p.wasted).filter((v): v is number => v !== null);
		return [0, Math.max(6, Math.ceil(Math.max(0, ...vs)))];
	});

	// Approach curves --------------------------------------------------------------------------------
	let showApproach = $state(false);
	const approach = useQuery(api.dashboard.approach, () => (showApproach ? { ...filter } : 'skip'));
	let approachView = $state<'dist' | 'chasing'>('dist');
	let highlight = $state<string>('auto');
	let hoverSeries = $state<string | null>(null);
	/** By default compare the best-ranked idea with the yardsticks. */
	const autoPick = $derived(
		orderedRows(main.cues, 'rank').find((r) => !r.thin && r.cond.role === 'idea')?.cond.id ?? null
	);
	const focusId = $derived(hoverSeries ?? (highlight === 'auto' ? autoPick : highlight === 'off' ? null : highlight));
	const approachSeries = $derived.by((): LineSeries[] => {
		const a = approach.data;
		if (!a) return [];
		return a.cues
			.filter((c) => c.trials > 0)
			.map((c) => {
				const cond = condition(c.cue);
				const emph = c.cue === focusId || (focusId !== null && (YARDSTICKS as readonly string[]).includes(c.cue));
				return {
					id: c.cue,
					label: cond.code,
					name: `${cond.code}. ${cond.name}`,
					color: cond.color,
					dash: cond.dash,
					values: approachView === 'dist' ? c.dist : c.chasing.map((v) => (v === null ? null : v * 100)),
					n: approachView === 'dist' ? c.distN : c.chasingN,
					emphasis: focusId === null ? false : emph,
					faint: c.trials < ENOUGH
				};
			});
	});
	const distMax = $derived(Math.max(6, ...(approach.data?.cues ?? []).flatMap((c) => c.dist.filter((v): v is number => v !== null))));
	const highlightOptions = $derived([
		{ value: 'auto', label: autoPick ? `Best ranked idea (${condition(autoPick).code})` : 'Best ranked idea' },
		{ value: 'off', label: 'None, all equal' },
		...CONDITIONS.map((c) => ({ value: c.id, label: `${c.code}. ${c.name}` }))
	]);

	// Learning ---------------------------------------------------------------------------------------
	function learningSeries(b: Main['learning']['byTrial']): LineSeries[] {
		return [
			{
				id: 'well', label: 'Well timed', name: 'Well-timed rate', color: WELL_COLOR, dots: true,
				values: b.map((x) => (x.n ? x.wellTimed.rate! * 100 : null)),
				lo: b.map((x) => (x.n ? x.wellTimed.lo! * 100 : null)), hi: b.map((x) => (x.n ? x.wellTimed.hi! * 100 : null)),
				n: b.map((x) => x.n)
			},
			{
				id: 'caught', label: 'Caught', name: 'Caught rate', color: CAUGHT_COLOR, dots: true,
				values: b.map((x) => (x.n ? x.caught.rate! * 100 : null)),
				lo: b.map((x) => (x.n ? x.caught.lo! * 100 : null)), hi: b.map((x) => (x.n ? x.caught.hi! * 100 : null)),
				n: b.map((x) => x.n)
			}
		];
	}
	const byTrial = $derived(main.learning.byTrial);
	const byBlock = $derived(main.learning.byBlock);

	// Said vs did ------------------------------------------------------------------------------------
	function ratingPoints(key: 'clarityCI' | 'distractionCI'): ScatterPoint[] {
		return main.cues
			.filter((c) => c[key].n > 0 && c.wellTimed.rate !== null)
			.map((c) => {
				const cond = condition(c.cue);
				const r = c[key];
				return {
					id: c.cue, label: cond.code, name: cond.name, x: r.mean!, y: c.wellTimed.rate! * 100,
					xlo: r.lo, xhi: r.hi, ylo: c.wellTimed.lo! * 100, yhi: c.wellTimed.hi! * 100,
					color: cond.color, shape: cond.shape, thin: c.inRates < ENOUGH,
					info: [
						[key === 'clarityCI' ? 'Clarity' : 'Distraction', `${r.mean!.toFixed(1)} of 7 (${plural(r.n, 'answer')})`],
						['Well timed', `${pct(c.wellTimed.rate)} of ${c.wellTimed.n}`],
						['95% interval', pctRange(c.wellTimed.lo, c.wellTimed.hi)]
					] as [string, string][]
				};
			});
	}
	const clarityPts = $derived(ratingPoints('clarityCI'));
	const distractPts = $derived(ratingPoints('distractionCI'));

	// Where the signal lives -------------------------------------------------------------------------
	const CHANNELS: CueChannel[] = ['hud', 'ghosts', 'player', 'maze', 'screen'];
	const channelRows = $derived.by((): ForestRow[] => {
		return CHANNELS.map((ch) => {
			const members = CONDITIONS.filter((c) => c.channel === ch && c.id !== 'none');
			const ss = members.map((m) => main.cues.find((c) => c.cue === m.id)).filter((s) => !!s);
			const n = ss.reduce((a, s) => a + s.wellTimed.n, 0);
			const well = ss.reduce((a, s) => a + s.wellTimed.k, 0);
			const caught = ss.reduce((a, s) => a + s.caught.k, 0);
			const pseudo: Condition = {
				id: ch, code: '', name: CHANNEL_LABEL[ch], role: 'idea', channel: ch, order: 0,
				color: 'var(--ink-dim)', shape: 'circle', dash: undefined
			};
			return {
				id: ch, cond: pseudo, thin: n < ENOUGH,
				values: { wellTimed: wilson(well, n), caught: wilson(caught, n) },
				note: `Conditions: ${members.map((m) => `${m.code} ${m.name}`).join(', ')}`
			};
		});
	});
	const noneRef = $derived.by(() => {
		const s = main.cues.find((c) => c.cue === 'none');
		if (!s || s.inRates < ENOUGH) return { wellTimed: [], caught: [] };
		const c = condition('none');
		return {
			wellTimed: [{ id: 'none', code: c.code, name: c.name, value: s.wellTimed.rate!, color: c.color, dash: c.dash }],
			caught: [{ id: 'none', code: c.code, name: c.name, value: s.caught.rate!, color: c.color, dash: c.dash }]
		};
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
			? 'Every power-up, including those outside the rates (grey).'
			: 'Counted power-ups, left to right from quitting too early to being caught. The green share is the well-timed rate, the red share the caught rate.'}
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
			title={stripView === 'turn' ? 'When players quit the chase' : 'Power thrown away'}
			sub={stripView === 'turn'
				? 'Each dot is one counted power-up, coloured by its outcome. Box: middle half. Tick: median. Click a dot for its replay.'
				: 'Seconds of power left after each early retreat. Box: middle half. Tick: median.'}
		>
			{#snippet actions()}
				<Segmented
					label="Measure"
					size="sm"
					options={[{ value: 'turn', label: 'Turn-away time' }, { value: 'wasted', label: 'Wasted power' }]}
					bind:value={stripView}
				/>
				<InfoTip term={stripView === 'turn' ? 'Turn-away time' : 'Wasted power'} align="end">
					{stripView === 'turn' ? DEFS.turnAway : DEFS.wasted}
				</InfoTip>
			{/snippet}
			{#if !points.data}
				<div class="loading">Loading every power-up…</div>
			{:else if !points.data.length}
				<EmptyState compact icon="chart" title="No turn-away times yet">They appear once players chase scared ghosts near the end of a power-up.</EmptyState>
			{:else}
				<div class="legend-row">
					<Legend
						label="Outcomes"
						items={OUTCOMES.filter((o) => o.inRates && o.id !== 'late-catch').map((o) => ({
							label: o.id === 'timely-retreat' ? 'Well timed (timely retreat or late catch)' : o.label, color: o.color, kind: 'swatch'
						}))}
					/>
				</div>
				{#if stripView === 'turn'}
					<StripPlot
						rows={pointRows}
						domain={turnDomain}
						window={{ from: 2, to: 0.2, label: 'well timed: 2 to 0.2 s left' }}
						zero={{ label: 'power ends' }}
						xLabel="Seconds of power left when the player turned away"
						ends={['quit early', 'too late']}
						format={(v) => (v === 0 ? '0' : v.toFixed(0))}
						caption="Turn-away time of every counted power-up per condition"
					/>
				{:else}
					<StripPlot
						rows={pointRows}
						domain={wastedDomain}
						xLabel="Seconds of power wasted"
						format={(v) => v.toFixed(0)}
						caption="Wasted power after every early retreat per condition"
					/>
				{/if}
			{/if}
		</Panel>
	</div>

	<div use:inview={() => (showApproach = true)}>
		<Panel
			title={approachView === 'dist' ? 'How close players stay as the power runs out' : 'Who is still chasing as the power runs out'}
			sub={approachView === 'dist'
				? 'Mean path distance to the nearest scared ghost, counted power-ups. Players who read the signal close in, then pull away before 0.'
				: 'Share of counted power-ups still closing in on a ghost. A good signal makes this drop inside the green window.'}
		>
			{#snippet actions()}
				<Segmented
					label="Approach measure"
					size="sm"
					options={[{ value: 'dist', label: 'Distance' }, { value: 'chasing', label: 'Still chasing' }]}
					bind:value={approachView}
				/>
				<InfoTip term="Approach curves" align="end">{approachView === 'dist' ? DEFS.approach : DEFS.stillChasing}</InfoTip>
			{/snippet}
			<div class="approach-tools">
				<Select size="sm" options={highlightOptions} bind:value={highlight} aria-label="Highlight a condition" />
				<Legend
					label="Line styles"
					items={[
						{ label: 'A No signal', color: ROLE_COLOR.reference, kind: 'line', dash: '5 4' },
						{ label: 'B Classic blink', color: ROLE_COLOR.reference, kind: 'line', dash: '1.5 3.5' },
						{ label: '0 Timer bar', color: ROLE_COLOR.baseline, kind: 'line' },
						{ label: 'Ideas 1-10', color: ROLE_COLOR.idea, kind: 'line' }
					]}
				/>
			</div>
			{#if !approach.data}
				<div class="loading">Averaging the 10 Hz series…</div>
			{:else if !approachSeries.length}
				<EmptyState compact icon="chart" title="No counted power-ups yet">The curves need counted power-ups.</EmptyState>
			{:else}
				<LineChart
					x={approach.data.bins}
					series={approachSeries}
					xDomain={[6, -3]}
					yDomain={approachView === 'dist' ? [0, Math.ceil(distMax)] : [0, 100]}
					xLabel="Seconds of power left (negative: after the end)"
					yLabel={approachView === 'dist' ? 'Tiles' : '% chasing'}
					xFormat={(v) => String(v)}
					yFormat={(v) => (approachView === 'dist' ? v.toFixed(0) : `${v.toFixed(0)}%`)}
					xTitle={(v) => (v > 0 ? `${v} s left` : v === 0 ? 'Power ends' : `${-v} s after the end`)}
					xTicks={[6, 5, 4, 3, 2, 1, 0, -1, -2, -3]}
					window={{ from: 2, to: 0.2, label: 'well timed' }}
					markers={[{ at: 0, label: 'power ends' }]}
					minN={3}
					height={320}
					caption="Approach curves per condition"
					onhoverseries={(id) => (hoverSeries = id)}
				/>
				<p class="foot">Points with fewer than 3 power-ups are not drawn. Faint lines: under {ENOUGH} counted power-ups. Hover a line to bring it forward.</p>
			{/if}
		</Panel>
	</div>

	<div class="two">
		<Panel title="Practice within a block" sub="All conditions together, by power-up number in its block.">
			{#snippet actions()}<InfoTip term="Learning" align="end">{DEFS.learning}</InfoTip>{/snippet}
			{#if byTrial.some((b) => b.n > 0)}
				<LineChart
					x={byTrial.map((b) => b.x)}
					series={learningSeries(byTrial)}
					xDomain={[1, main.learning.maxTrialBucket]}
					yDomain={[0, 100]}
					xLabel="Power-up number within the block"
					yLabel="% of counted"
					xFormat={(v) => (v === main.learning.maxTrialBucket ? `${v}+` : String(v))}
					yFormat={(v) => `${v.toFixed(0)}%`}
					xTitle={(v) => `Power-up ${v}${v === main.learning.maxTrialBucket ? ' and later' : ''}`}
					xTicks={byTrial.map((b) => b.x)}
					height={240}
					caption="Well-timed and caught rate by power-up number within a block"
				/>
				<p class="foot">Bands: 95% intervals. n per point in the tooltip.</p>
			{:else}
				<EmptyState compact icon="chart" title="No counted power-ups yet" />
			{/if}
		</Panel>
		<Panel title="Practice across the session" sub="All conditions together, by block position (1 = first condition played).">
			{#snippet actions()}<InfoTip term="Learning" align="end">{DEFS.learning}</InfoTip>{/snippet}
			{#if byBlock.length > 1}
				<LineChart
					x={byBlock.map((b) => b.x)}
					series={learningSeries(byBlock)}
					xDomain={[1, Math.max(2, byBlock.length)]}
					yDomain={[0, 100]}
					xLabel="Block position in the session"
					yLabel="% of counted"
					yFormat={(v) => `${v.toFixed(0)}%`}
					xTitle={(v) => `Block ${v}`}
					xTicks={byBlock.map((b) => b.x)}
					height={240}
					caption="Well-timed and caught rate by block position in the session"
				/>
				<p class="foot">The counterbalanced order spreads practice evenly over the conditions.</p>
			{:else}
				<EmptyState compact icon="chart" title="Needs sessions with more than one block">Study sessions play one block per condition.</EmptyState>
			{/if}
		</Panel>
	</div>

	<div class="two">
		<Panel title="Felt clear vs was well timed" sub="Each point is a condition: questionnaire clarity against measured well-timed rate.">
			{#snippet actions()}<InfoTip term="Clarity" align="end">{DEFS.clarity}</InfoTip>{/snippet}
			{#if clarityPts.length}
				<ScatterPlot
					points={clarityPts}
					xDomain={[1, 7]}
					yDomain={[0, 100]}
					xLabel="Clarity rating (1-7)"
					xEnds={['unclear', 'clear']}
					yLabel="% well timed"
					yFormat={(v) => `${v.toFixed(0)}%`}
					caption="Clarity rating against well-timed rate per condition"
				/>
				<p class="foot">Whiskers: 95% intervals. If players' sense of clarity matched their play, points would rise to the right.</p>
			{:else}
				<EmptyState compact icon="study" title="No questionnaire answers yet">
					Players rate each signal after its block in the study. Simulated players do not answer.
				</EmptyState>
			{/if}
		</Panel>
		<Panel title="Felt distracting vs was well timed" sub="Questionnaire distraction against measured well-timed rate.">
			{#snippet actions()}<InfoTip term="Distraction" align="end">{DEFS.distraction}</InfoTip>{/snippet}
			{#if distractPts.length}
				<ScatterPlot
					points={distractPts}
					xDomain={[1, 7]}
					yDomain={[0, 100]}
					xLabel="Distraction rating (1-7)"
					xEnds={['not at all', 'very']}
					yLabel="% well timed"
					yFormat={(v) => `${v.toFixed(0)}%`}
					caption="Distraction rating against well-timed rate per condition"
				/>
				<p class="foot">The ideal signal sits top left: well timed and not in the way.</p>
			{:else}
				<EmptyState compact icon="study" title="No questionnaire answers yet" />
			{/if}
		</Panel>
	</div>

	<Panel title="Where the signal lives" sub="Conditions pooled by where the signal is shown. No signal (A) is the yardstick line.">
		{#snippet actions()}<InfoTip term="Channel" align="end">{DEFS.channel}</InfoTip>{/snippet}
		<ForestChart
			rows={channelRows}
			columns={[
				{ key: 'wellTimed', title: 'Well-timed rate', better: 'higher', refs: noneRef.wellTimed },
				{ key: 'caught', title: 'Caught rate', better: 'lower', refs: noneRef.caught }
			]}
			caption="Well-timed and caught rate pooled by where the signal is shown"
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
	.approach-tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-5);
		margin-bottom: var(--space-3);
	}
	.foot {
		margin-top: var(--space-2);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.loading {
		padding: var(--space-6) 0;
		color: var(--ink-faint);
		text-align: center;
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
