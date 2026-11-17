<script lang="ts">
	/**
	 * The answer in words, as strong as the adjusted comparisons allow (insight.ts): the headline,
	 * the groups and how the ideas stand against each yardstick, what is still undecided, and the
	 * rest on request. Its own component so a phone can show it above the filters.
	 */
	import { InfoTip } from '#lib/ui/index.ts';
	import { plural } from '#lib/charts/encoding.ts';
	import { ENOUGH, RANK_PEOPLE, type Insight } from './insight';
	import type { RunInfo } from './types';

	interface Props {
		take: Insight;
		simulated: boolean;
		run?: RunInfo | null;
		otherRun?: boolean;
		/** The "too early" line in force when it is not the rules' own (2.5 s). */
		altLine?: number | null;
	}
	let { take, simulated, run = null, otherRun = false, altLine = null }: Props = $props();
	const presetWord = (p: string) => (p === 'flat' ? 'flat' : p === 'planted' ? 'planted' : p);
</script>

<div class="takeaway tone-{take.tone}">
	<p class="eyebrow">
		{#if simulated && otherRun}
			Pipeline check: simulated play outside any run
		{:else if simulated && run}
			Pipeline check on one simulator run: {presetWord(run.preset)}, {plural(run.sessions, 'player')}, {plural(run.trials, 'power-up')}
		{:else if simulated}
			Pipeline check on simulated players
		{:else}
			The answer so far
		{/if}
		{#if altLine}<span class="alt">"Too early" from {altLine} s</span>{/if}
		<InfoTip term="How strong is this?" align="start">
			A condition is ranked only with {ENOUGH} or more counted power-ups from {RANK_PEOPLE} or more people. A difference is
			called clear only when it holds inside each person (paired) and survives Holm's adjustment for every comparison in its
			family: the 78 pairs of the 13 conditions, or the 12 comparisons against one yardstick (the timer bar, the classic blink,
			no signal). The top group is the highest condition and every condition not clearly behind it; the leaders are those of
			it that are each clearly ahead of every condition outside it. Anything weaker is reported as possibly chance.
			<a href="#method">How this is measured</a>
		</InfoTip>
	</p>
	<p class="headline">{take.headline}</p>
	{#if take.details.length}
		<ul class="details">
			{#each take.details as d (d)}<li>{d}</li>{/each}
		</ul>
	{/if}
	{#if take.more.length}
		<details class="more">
			<summary>More: {take.more.length === 1 ? 'one more finding' : `${take.more.length} more findings`}</summary>
			<ul class="details">
				{#each take.more as d (d)}<li>{d}</li>{/each}
			</ul>
		</details>
	{/if}
	{#if simulated && run?.preset === 'flat'}
		<p class="flat-note">This run gave every condition the same awareness, so any difference here is noise. Seeing none is the expected result.</p>
	{/if}
</div>

<style>
	.takeaway {
		padding: var(--space-5) var(--space-5) var(--space-5) calc(var(--space-5) + 4px);
		border-radius: var(--radius-lg);
		background: linear-gradient(90deg, var(--accent-soft), transparent 70%), var(--surface);
		border: 1px solid var(--rule);
		box-shadow: inset 4px 0 0 var(--accent);
	}
	.takeaway.tone-thin,
	.takeaway.tone-empty,
	.takeaway.tone-few,
	.takeaway.tone-none {
		background: var(--surface);
		box-shadow: inset 4px 0 0 var(--ink-faint);
	}
	.takeaway.tone-thin,
	.takeaway.tone-few,
	.takeaway.tone-empty {
		box-shadow: inset 4px 0 0 var(--warn);
	}
	.eyebrow {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin-bottom: var(--space-2);
	}
	.alt {
		padding: 1px 8px;
		border: 1px solid var(--warn);
		border-radius: 999px;
		color: var(--ink);
		font-size: var(--text-xs);
		letter-spacing: 0;
		text-transform: none;
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
		gap: 4px;
		max-width: 86ch;
		margin: var(--space-3) 0 0;
		padding-left: 1.1em;
		color: var(--ink-dim);
	}
	.more {
		margin-top: var(--space-2);
		color: var(--ink-dim);
	}
	.more summary {
		color: var(--focus);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.more .details {
		margin-top: var(--space-2);
	}
	.flat-note {
		max-width: 86ch;
		margin-top: var(--space-3);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	a {
		color: var(--focus);
	}
	@media (max-width: 760px) {
		.takeaway {
			padding: var(--space-4) var(--space-4) var(--space-4) calc(var(--space-4) + 4px);
		}
		.headline {
			font-size: var(--text-lg);
		}
	}
</style>
