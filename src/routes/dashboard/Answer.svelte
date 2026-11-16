<script lang="ts">
	/**
	 * The answer first: the takeaway in words (only as strong as the intervals allow), what it rests
	 * on, and the ranking of all thirteen conditions on well-timed rate next to caught rate, with the
	 * references and the timer bar drawn as yardstick lines.
	 */
	import { CueChip, InfoTip, Panel, Stat } from '#lib/ui/index.ts';
	import ForestChart, { type ForestColumn, type ForestRef, type ForestRow } from '#lib/charts/ForestChart.svelte';
	import Legend from '#lib/charts/Legend.svelte';
	import RoleMark from '#lib/charts/RoleMark.svelte';
	import { CONDITIONS, condition, plural, ROLE_COLOR, YARDSTICKS } from '#lib/charts/encoding.ts';
	import { DEFS } from './defs';
	import { ENOUGH, insight } from './insight';
	import { orderedRows } from './rows';
	import type { Main } from './types';

	interface Props {
		main: Main;
		selected: string | null;
		onselect: (id: string) => void;
		simulated: boolean;
	}
	let { main, selected, onselect, simulated }: Props = $props();

	const take = $derived(insight(main.cues, (id) => condition(id), CONDITIONS.map((c) => c.id)));
	const rows = $derived(orderedRows(main.cues, 'rank'));
	const ranked = $derived(rows.filter((r) => !r.thin).length);

	/** Yardstick lines: only for references with enough data, so a thin yardstick never misleads. */
	function refs(key: 'wellTimed' | 'caught'): ForestRef[] {
		return YARDSTICKS.flatMap((id) => {
			const s = main.cues.find((c) => c.cue === id);
			if (!s || s.inRates < ENOUGH || s[key].rate === null) return [];
			const c = condition(id);
			return [{ id, code: c.code, name: c.name, value: s[key].rate!, color: c.color, dash: c.dash }];
		});
	}
	const columns = $derived<ForestColumn[]>([
		{ key: 'wellTimed', title: 'Well-timed rate', better: 'higher', refs: refs('wellTimed') },
		{ key: 'caught', title: 'Caught rate', better: 'lower', refs: refs('caught') }
	]);
	const forestRows = $derived<ForestRow[]>(rows.map((r) => ({
		id: r.cond.id,
		cond: r.cond,
		thin: r.thin,
		group: r.group,
		values: { wellTimed: r.s?.wellTimed ?? null, caught: r.s?.caught ?? null },
		note: r.s ? `${plural(r.s.trials, 'power-up')} in total, ${plural(r.s.participants, 'participant')}` : undefined
	})));
	const yardsticksDrawn = $derived(columns[0].refs.length > 0);
</script>

<section class="answer" aria-labelledby="answer-h">
	<h2 id="answer-h" class="visually-hidden">The answer</h2>
	<div class="takeaway tone-{take.tone}">
		<p class="eyebrow">
			{#if simulated}Pipeline check on simulated players{:else}The answer so far{/if}
			<InfoTip term="How strong is this?" align="start">
				A condition is ranked only with {ENOUGH} or more counted power-ups. "Clearly" means the two 95% intervals do not overlap,
				a strict test; anything weaker is reported as overlapping. <a href="#method">How this is measured</a>
			</InfoTip>
		</p>
		<p class="headline">{take.headline}</p>
		{#if take.details.length}
			<ul class="details">
				{#each take.details as d (d)}<li>{d}</li>{/each}
			</ul>
		{/if}
	</div>

	<div class="basis">
		<Stat label="Participants" value={main.totals.participants} info={DEFS.participants} sub={plural(main.totals.sessions, 'session')} />
		<Stat label="Power-ups" value={main.totals.trials} info={DEFS.trial} sub="{main.totals.engaged} engaged" />
		<Stat label="Counted" value={main.totals.inRates} info={DEFS.counted} sub="behind every rate" />
		<Stat
			label="Ranked conditions"
			value={ranked}
			unit="of 13"
			info={DEFS.notEnough}
			sub={ranked < 13 ? `${13 - ranked} under ${ENOUGH} counted` : 'all have enough data'}
			tone={ranked === 0 ? 'warn' : 'ink'}
		/>
	</div>

	<Panel title="Which signal tells players best" sub="Every condition on the two headline rates, with 95% intervals. Click a row for its details.">
		{#snippet actions()}
			<InfoTip term="Well-timed rate" align="end">{DEFS.wellTimed} {DEFS.interval}</InfoTip>
			<InfoTip term="Caught rate" align="end">{DEFS.caught}</InfoTip>
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
					A point right of a line beats it on well-timed rate (left of it, on caught rate); the interval says whether that is clear.
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
			caption="Well-timed rate and caught rate per condition with 95% Wilson intervals"
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
	.takeaway.tone-empty {
		background: var(--surface);
		box-shadow: inset 4px 0 0 var(--warn);
	}
	.eyebrow {
		display: flex;
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
		max-width: 80ch;
		margin: var(--space-3) 0 0;
		padding-left: 1.1em;
		color: var(--ink-dim);
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
