<script lang="ts">
	/**
	 * End of the study: pick the clearest and the least clear round. Each round is shown by a looping
	 * preview of its signal on the same short moment of play, so it can be recognised without a name.
	 */
	import type { Cue } from '../game/types';
	import CuePreview from '#lib/ui/CuePreview.svelte';
	import { Button, Page, Panel } from '#lib/ui/index.ts';

	export interface Picks { clearest: number; leastClear: number; comment: string }
	interface Props {
		cues: Cue[];
		onsubmit: (p: Picks) => void;
	}
	let { cues, onsubmit }: Props = $props();

	let clearest = $state<number | null>(null);
	let leastClear = $state<number | null>(null);
	let comment = $state('');
	const ready = $derived(clearest !== null && leastClear !== null && clearest !== leastClear);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!ready) return;
		onsubmit({ clearest: clearest!, leastClear: leastClear!, comment: comment.trim().slice(0, 2000) });
	}
</script>

<Page width="wide">
	<form class="pick" onsubmit={submit}>
		<p class="eyebrow">Last step</p>
		<h1>Which round told you best that the power was running out?</h1>
		<p class="lead">
			Each tile replays one of your rounds' signals on the same short moment: a power dot, a chase, and the
			power running out. Pick the clearest one and the least clear one.
		</p>

		<ul class="grid">
			{#each cues as cue, i (cue.id)}
				<li class="card" class:best={clearest === i} class:worst={leastClear === i}>
					<div class="thumb"><CuePreview {cue} fps={15} /></div>
					<p class="name">Round {i + 1}</p>
					<div class="opts">
						<label class="o good"><input type="radio" name="clearest" value={i} bind:group={clearest} disabled={leastClear === i} /> Clearest</label>
						<label class="o bad"><input type="radio" name="least" value={i} bind:group={leastClear} disabled={clearest === i} /> Least clear</label>
					</div>
				</li>
			{/each}
		</ul>

		<Panel title="Anything else?" sub="Optional" level={2}>
			<label class="visually-hidden" for="study-comment">Comment</label>
			<textarea id="study-comment" bind:value={comment} rows="3" maxlength="2000" placeholder="What helped, what was confusing, anything you noticed"></textarea>
		</Panel>

		<div class="go">
			<Button variant="primary" size="lg" type="submit" disabled={!ready}>Finish and see my results</Button>
			{#if !ready}<span class="hint">Pick one clearest and one least clear round (two different rounds).</span>{/if}
		</div>
	</form>
</Page>

<style>
	.pick { display: flex; flex-direction: column; gap: var(--space-4); padding-bottom: var(--space-6); }
	.eyebrow { color: var(--accent); }
	h1 { font-size: var(--text-2xl); font-weight: 600; line-height: 1.15; max-width: 30ch; }
	.lead { color: var(--ink-dim); max-width: 64ch; }
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.card.best { border-color: var(--good); box-shadow: inset 0 0 0 1px var(--good); }
	.card.worst { border-color: var(--bad); box-shadow: inset 0 0 0 1px var(--bad); }
	.thumb { aspect-ratio: 19 / 21; border-radius: var(--radius-sm); overflow: hidden; background: #05070f; }
	.name { font-weight: 700; padding: 0 var(--space-1); }
	.opts { display: flex; flex-direction: column; gap: 4px; padding: 0 var(--space-1) var(--space-1); }
	.o { display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-sm); cursor: pointer; }
	.o.good input { accent-color: var(--good); }
	.o.bad input { accent-color: var(--bad); }
	.o:has(input:disabled) { color: var(--ink-faint); cursor: default; }
	textarea {
		width: 100%;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--rule-strong);
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
		resize: vertical;
	}
	textarea:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
	.go { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
	.hint { color: var(--ink-dim); font-size: var(--text-sm); }
	@media (max-width: 520px) {
		.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
</style>
