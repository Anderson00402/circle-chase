<script lang="ts">
	/** The two questions after each round (STUDY.md "Self-report") and an optional line of free text. */
	import { Button, Page, Panel, Scale7 } from '#lib/ui/index.ts';

	export interface RoundAnswers { clarity: number; distraction: number; note: string }
	interface Props {
		round: number;
		of: number;
		last: boolean;
		onsubmit: (a: RoundAnswers) => void;
	}
	let { round, of, last, onsubmit }: Props = $props();

	let clarity = $state<number | null>(null);
	let distraction = $state<number | null>(null);
	let note = $state('');
	const ready = $derived(clarity !== null && distraction !== null);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (clarity === null || distraction === null) return;
		onsubmit({ clarity, distraction, note: note.trim().slice(0, 300) });
	}
</script>

<Page width="narrow">
	<form class="rate" onsubmit={submit}>
		<p class="eyebrow">Round {round} of {of} done</p>
		<h1>Two quick questions about that round</h1>
		<Panel level={2}>
			<div class="qs">
				<Scale7 question="I could tell when the power was about to run out." low="Not at all" high="Completely" bind:value={clarity} required />
				<Scale7 question="The signal got in the way of playing." low="Not at all" high="Very much" bind:value={distraction} required />
				<label class="free">
					<span>What told you the power was ending? <span class="opt">Optional</span></span>
					<input type="text" bind:value={note} maxlength="300" autocomplete="off" placeholder="In your own words" />
				</label>
			</div>
		</Panel>
		<div class="go">
			<Button variant="primary" size="lg" type="submit" disabled={!ready}>{last ? 'Continue' : 'Next round'}</Button>
			{#if !ready}<span class="hint">Answer both questions to continue.</span>{/if}
		</div>
	</form>
</Page>

<style>
	.rate { display: flex; flex-direction: column; gap: var(--space-4); padding-bottom: var(--space-6); }
	.eyebrow { color: var(--accent); }
	h1 { font-size: var(--text-2xl); font-weight: 600; line-height: 1.15; }
	.qs { display: flex; flex-direction: column; gap: var(--space-5); }
	.free { display: flex; flex-direction: column; gap: var(--space-2); }
	.opt { color: var(--ink-faint); font-size: var(--text-sm); margin-left: 4px; }
	.free input {
		height: 40px;
		padding: 0 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--rule-strong);
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
	}
	.free input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
	.go { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
	.hint { color: var(--ink-dim); font-size: var(--text-sm); }
</style>
