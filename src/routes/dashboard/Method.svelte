<script lang="ts">
	/** "How this is measured": the study design in three lines and every definition in plain words. */
	import { Panel } from '#lib/ui/index.ts';
	import { OUTCOMES } from '#lib/charts/encoding.ts';
	import RoleMark from '#lib/charts/RoleMark.svelte';
	import { DEFS, DESIGN, OUTCOME_ORDER_NOTE } from './defs';

	const terms: [string, string][] = [
		['Power-up (trial)', DEFS.trial],
		['Chasing', DEFS.chasing],
		['Engaged', DEFS.engaged],
		['Counted', DEFS.counted],
		['Well-timed rate', DEFS.wellTimed],
		['Caught rate', DEFS.caught],
		['95% interval', DEFS.interval],
		['Not enough data', DEFS.notEnough],
		['Turn-away time', DEFS.turnAway],
		['Wasted power', DEFS.wasted],
		['Approach curve', DEFS.approach],
		['Clarity and distraction', `${DEFS.clarity} ${DEFS.distraction}`],
		['Where the signal lives', DEFS.channel],
		['Simulated players', DEFS.simulated]
	];
</script>

<section id="method" class="method" aria-labelledby="method-h">
	<header>
		<p class="eyebrow">Method</p>
		<h2 id="method-h">How this is measured</h2>
	</header>
	<div class="grid">
		<Panel title="The study in three lines">
			<ol class="design">
				{#each DESIGN as d (d)}<li>{d}</li>{/each}
			</ol>
			<p class="q">
				The question: do players know when the power-up is about to run out, and which signal tells them best? Their own
				behaviour at the end of each power-up answers it: players who know chase right up to the end and get out in time.
			</p>
		</Panel>
		<Panel title="Outcomes">
			<p class="note">{OUTCOME_ORDER_NOTE}</p>
			<dl class="outcomes">
				{#each OUTCOMES as o (o.id)}
					<dt><RoleMark shape="square" color={o.color} size={11} hollow={o.hatch} /> {o.label}</dt>
					<dd>{o.def}</dd>
				{/each}
			</dl>
		</Panel>
	</div>
	<Panel title="Definitions">
		<dl class="terms">
			{#each terms as [t, d] (t)}
				<div><dt>{t}</dt><dd>{d}</dd></div>
			{/each}
		</dl>
		<p class="note">
			Distances are path distances through the maze in tiles. Rates treat power-ups as independent; several come from the same
			person, so the true uncertainty is somewhat wider than the intervals shown. Full definitions: docs/STUDY.md in the repository.
		</p>
	</Panel>
</section>

<style>
	.method {
		display: grid;
		gap: var(--space-5);
		scroll-margin-top: calc(var(--bar-h) + 72px);
	}
	h2 {
		font-size: var(--text-xl);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-5);
	}
	.design {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding-left: 1.2em;
		color: var(--ink-dim);
	}
	.q {
		margin-top: var(--space-3);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.note {
		margin-bottom: var(--space-3);
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}
	.outcomes {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
	}
	.outcomes dt {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 650;
		white-space: nowrap;
	}
	.outcomes dd {
		margin: 0;
		color: var(--ink-dim);
	}
	.terms {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3) var(--space-6);
		margin: 0 0 var(--space-4);
	}
	.terms dt {
		font-weight: 700;
	}
	.terms dd {
		margin: 2px 0 0;
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	@media (max-width: 860px) {
		.grid,
		.terms {
			grid-template-columns: minmax(0, 1fr);
		}
		.outcomes {
			grid-template-columns: minmax(0, 1fr);
		}
		.outcomes dd {
			margin-bottom: 6px;
		}
	}
</style>
