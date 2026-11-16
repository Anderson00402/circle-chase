<script lang="ts">
	/**
	 * Planted vs recovered (simulated view only). The simulator declares how aware its bots are under
	 * each condition; this panel shows whether the real measuring pipeline recovers that order. It
	 * validates the instrument and says nothing about real cues.
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { Badge, CueChip, InfoTip, Panel } from '#lib/ui/index.ts';
	import ForestChart, { type ForestRow } from '#lib/charts/ForestChart.svelte';
	import ScatterPlot, { type ScatterPoint } from '#lib/charts/ScatterPlot.svelte';
	import { condition, pct, pctRange, plural } from '#lib/charts/encoding.ts';
	import { ENOUGH } from './insight';
	import type { Main } from './types';

	interface Props {
		/** The simulator run the whole page shows. */
		run: string;
		preset: string | null;
		/** The page's results for this run (for the adjusted pair comparisons). */
		main: Main;
	}
	let { run, preset, main }: Props = $props();

	const check = useQuery(api.dashboard.simCheck, () => ({ run }), { keepPreviousData: true });
	const d = $derived(check.data && check.data.run === run ? check.data : null);

	const flat = $derived((d?.preset ?? preset) === 'flat');
	const enough = $derived((d?.cues ?? []).filter((c) => c.inRates >= ENOUGH));
	/** Pairs that differ clearly on the well-timed rate after Holm's adjustment (paired within players). */
	const clearPairs = $derived({ k: main.pairs.wellTimed.filter((c) => c.clear).length, of: main.pairs.wellTimed.length });
	const verdict = $derived.by(() => {
		if (!d) return '';
		if (enough.length < 2) return `Not enough simulated power-ups yet to judge (${enough.length} conditions with ${ENOUGH} or more counted).`;
		if (flat)
			return clearPairs.k === 0
				? `Flat run: every condition was given the same awareness, and none of the ${clearPairs.of} pairs of conditions differs clearly once the comparisons are adjusted. The pipeline does not invent differences.`
				: `Flat run: every condition was given the same awareness, yet ${clearPairs.k} of ${clearPairs.of} pairs differ clearly even after adjusting for the number of comparisons. That should happen in under 5% of flat runs; check the measure for a bias that is not awareness.`;
		const rho = d.rhos.wellTimed;
		if (rho === null) return '';
		const strength = rho <= -0.8 ? 'closely' : rho <= -0.5 ? 'roughly' : rho < 0 ? 'only weakly' : 'not';
		const r = (x: number | null) => (x === null ? '–' : x.toFixed(2));
		return `Planted run: the measured well-timed rate follows the planted awareness ${strength} (rank correlation ${rho.toFixed(2)}; -1 would be a perfect recovery). Too late ${r(d.rhos.tooLate)}, too early ${r(d.rhos.tooEarly)} (+1 would be perfect for these). ${clearPairs.k} of ${clearPairs.of} pairs differ clearly after adjustment: with ${plural(d.participants, 'simulated player')}, the order is recovered before single pairs separate.`;
	});

	const rows = $derived<ForestRow[]>((d?.cues ?? []).map((c) => ({
		id: c.cue,
		cond: condition(c.cue),
		thin: c.inRates < ENOUGH,
		values: { wellTimed: c.wellTimed, tooLate: c.tooLate, tooEarly: c.tooEarly },
		note: `Planted noise ${c.plantedNoise} s, distraction ${c.plantedDistraction}; ${c.inRates} counted from ${plural(c.participants, 'participant')}, caught ${pct(c.caught.rate)}, ${plural(c.catches.n, 'catch', 'catches')} not counted; measured distraction ${c.distraction.mean ?? '–'} (${c.distraction.n} answers)`
	})));
	const points = $derived<ScatterPoint[]>((d?.cues ?? []).filter((c) => c.wellTimed.rate !== null).map((c) => {
		const k = condition(c.cue);
		return {
			id: c.cue, label: k.code, name: k.name, x: c.plantedNoise, y: c.wellTimed.rate! * 100,
			ylo: c.wellTimed.lo! * 100, yhi: c.wellTimed.hi! * 100, color: k.color, shape: k.shape, thin: c.inRates < ENOUGH,
			info: [
				['Planted noise', `${c.plantedNoise} s`],
				['Turned away in time', `${pct(c.wellTimed.rate)} of ${c.wellTimed.n}`],
				['95% interval', pctRange(c.wellTimed.lo, c.wellTimed.hi)],
				['Too late', `${pct(c.tooLate.rate)} (caught ${pct(c.caught.rate)})`],
				['Too early', pct(c.tooEarly.rate)]
			] as [string, string][]
		};
	}));
	const maxNoise = $derived(Math.max(2.5, ...(d?.cues ?? []).map((c) => c.plantedNoise)));
</script>

<section class="sim" aria-labelledby="sim-h">
	<Panel>
		<div class="head">
			<div>
				<p class="eyebrow"><Badge tone="sim">Simulated</Badge> Instrument check</p>
				<h2 id="sim-h">Does the pipeline find what was planted?</h2>
			</div>
		</div>
		<p class="explain">
			The simulator gives its bots a declared awareness of the time left for each condition (the planted "noise": how wrong they
			are about the time left, in seconds; lower is better). The bots then play the real game and the real tracker measures them.
			If the measures work, conditions with less planted noise come out better timed. This validates the instrument; it says
			nothing about which real signal is better, because a bot cannot see a signal.
			<InfoTip term="Planted vs recovered" align="start">
				Planted levels are invented (src/lib/sim/model.ts). The flat preset gives every condition the same level: the
				dashboard should then show no clear differences.
			</InfoTip>
		</p>
		{#if !d}
			<p class="dim">Loading…</p>
		{:else}
			<p class="verdict">{verdict}</p>
			<p class="dim">{plural(d.trials, 'power-up')} from {plural(d.participants, 'simulated participant')} in this run.</p>
			<div class="two" class:single={flat}>
				{#if !flat}
					<div>
						<h3>Planted noise against turning away in time</h3>
						<ScatterPlot
							{points}
							xDomain={[0, Math.ceil(maxNoise * 2) / 2]}
							yDomain={[0, 100]}
							xLabel="Planted awareness noise (s)"
							xEnds={['aware', 'guessing']}
							yLabel="% turned away in time"
							xFormat={(v) => v.toFixed(1)}
							yFormat={(v) => `${v.toFixed(0)}%`}
							height={300}
							caption="Planted noise against measured well-timed rate per condition"
						/>
						<p class="foot">Recovery works if points fall from left to right.</p>
					</div>
				{/if}
				<div>
					<h3>Measured rates, in planted order (least noise first)</h3>
					<ForestChart
						{rows}
						columns={[
							{ key: 'wellTimed', title: 'In time', better: 'higher', refs: [] },
							{ key: 'tooLate', title: 'Too late', better: 'lower', refs: [] },
							{ key: 'tooEarly', title: 'Too early', better: 'lower', refs: [] }
						]}
						caption="Measured turned away in time, too late and too early per condition, in planted order"
					>
						{#snippet label(row)}
							{@const c = d.cues.find((x) => x.cue === row.id)}
							<span class="lab"><CueChip cue={row.cond} compact size="sm" /><span class="pl num">{c?.plantedNoise.toFixed(1)} s</span></span>
						{/snippet}
					</ForestChart>
				</div>
			</div>
		{/if}
	</Panel>
</section>

<style>
	.sim {
		margin-top: var(--space-5);
	}
	.sim :global(.panel) {
		border-style: dashed;
		border-color: color-mix(in srgb, var(--sim) 55%, transparent);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	h2 {
		font-size: var(--text-xl);
	}
	h3 {
		margin-bottom: var(--space-3);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		font-weight: 700;
	}
	.explain {
		max-width: 90ch;
		margin: var(--space-3) 0;
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.verdict {
		max-width: 80ch;
		font-size: var(--text-lg);
		font-weight: 650;
		line-height: 1.35;
	}
	.dim {
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}
	/* Stacked: the forest has three rate columns and needs the full width. */
	.two {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6);
		margin-top: var(--space-5);
	}
	.two.single {
		grid-template-columns: minmax(0, 1fr);
	}
	.lab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.pl {
		color: var(--ink-dim);
		font-size: var(--text-xs);
	}
	.foot {
		margin-top: var(--space-2);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	@media (max-width: 960px) {
		.two {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
