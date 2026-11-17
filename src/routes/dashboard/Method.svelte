<script lang="ts">
	/** "How this is measured": the study design in three lines and every definition in plain words. */
	import { Panel } from '#lib/ui/index.ts';
	import { OUTCOMES } from '#lib/charts/encoding.ts';
	import RoleMark from '#lib/charts/RoleMark.svelte';
	import { OUTCOME_INFO } from '#lib/outcomes.ts';
	import { DEFS, DESIGN, OUTCOME_ORDER_NOTE } from './defs';

	const terms: [string, string][] = [
		['Power-up (trial)', DEFS.trial],
		['Chasing', DEFS.chasing],
		['Scared ghosts flee (study rules)', DEFS.fleeing],
		['Engaged', DEFS.engaged],
		['Counted', DEFS.counted],
		[OUTCOME_INFO['timely-retreat'].label, DEFS.wellTimed],
		['Too late', DEFS.tooLate],
		[OUTCOME_INFO.caught.label, DEFS.caught],
		['Too early', DEFS.tooEarly],
		[OUTCOME_INFO.catch.label, DEFS.catches],
		['95% interval', DEFS.interval],
		['Clear difference', DEFS.clear],
		['Top group and leaders', DEFS.groups],
		['Paired difference (within people)', DEFS.paired],
		['Turn-away time, within people', DEFS.turnPaired],
		['Ratings, within people', DEFS.ratingsPaired],
		['Breakdowns', DEFS.breakdown],
		['People needed', DEFS.precision],
		['Not enough data', DEFS.notEnough],
		['Turn-away time', DEFS.turnAway],
		['Never turned', DEFS.neverTurned],
		['Gave up very early', DEFS.gaveUpEarly],
		['Wasted power', DEFS.wasted],
		['Too early from (2 s or 2.5 s)', DEFS.line],
		['Time to spare', DEFS.timeToSpare],
		['Approach curve: still chasing', DEFS.stillChasing],
		['Approach curve: distance', DEFS.approach],
		['Clarity and distraction', `${DEFS.clarity} ${DEFS.distraction}`],
		['Where the signal lives', DEFS.channel],
		['Simulated players', `${DEFS.simulated} The simulated view shows one simulator run at a time: a flat run gives every condition the same awareness (the page should find no differences), a planted run gives each its own (the page should recover the order). Simulated play outside a run is its own choice.`]
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
		<Panel title="How conditions are compared">
			<ol class="design">
				<li>Rates per condition pool everyone's counted power-ups; their 95% intervals resample people, not power-ups.</li>
				<li>
					Differences are worked out inside each person: for each person who played both conditions, their rate under one minus
					under the other. The average of those differences, and a t-test over people, say how big and how sure the difference is.
				</li>
				<li>
					Many comparisons at once would throw up false differences by luck (about 4 of 78 pairs at the usual 5% level). Holm's
					method adjusts every family of comparisons together: all 78 pairs for "is one condition best?", and the 12 against the
					timer bar for "is an idea better than the timer bar?". Only differences that survive are called clear.
				</li>
				<li>
					The takeaway is written around groups: the leaders and the top group when the adjusted comparisons support one, how the
					ideas stand against each yardstick, and what is still undecided. When nothing survives, it says no condition stands out
					and gives the highest rate only as a fact. With fewer than 5 people who played both conditions no test runs, and it says
					there are too few people to compare yet.
				</li>
			</ol>
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
	<Panel title="Two checks on the measure">
		<ul class="design">
			<li><b>Too early from 2.5 s.</b> {DEFS.line}</li>
			<li><b>Time to spare.</b> {DEFS.timeToSpare} The view is under "When players quit the chase".</li>
			<li>{DEFS.limits}</li>
		</ul>
	</Panel>
	<Panel title="Definitions">
		<dl class="terms">
			{#each terms as [t, d] (t)}
				<div><dt>{t}</dt><dd>{d}</dd></div>
			{/each}
		</dl>
		<p class="note">
			Distances are path distances through the maze in tiles. The headline intervals resample people, not single power-ups,
			because one person's power-ups are alike; learning curves and the pooled channel view use Wilson intervals and are a little
			too narrow. Why catches are left out: eating a ghost shows the player was chasing, not whether they knew the time left, and a
			lucky late catch looks the same as a well-judged one. Why "caught" needs the 5 tiles: a player who turned away in time and
			was caught later from far away did not misjudge the end. Full definitions: docs/STUDY.md in the repository.
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
