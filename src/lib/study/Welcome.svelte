<script lang="ts">
	/**
	 * First screen of the study: what it is, what is recorded, how long it takes, controls, a sound
	 * check and the session length. Nothing is stored until the participant presses start.
	 */
	import { onDestroy } from 'svelte';
	import { createSfx } from '../game/audio/sfx';
	import type { StudyLength } from './order';
	import type { SoundCheck } from './progress';
	import { Button, Field, Kbd, Page, PageHeader, Panel } from '#lib/ui/index.ts';

	export interface WelcomeChoice {
		length: StudyLength;
		nickname: string;
		soundCheck: SoundCheck;
	}
	interface Props {
		/** Conditions in a full session (the list may grow). */
		total: number;
		quick: number;
		busy?: boolean;
		error?: string;
		onstart: (c: WelcomeChoice) => void;
	}
	let { total, quick, busy = false, error, onstart }: Props = $props();

	let length = $state<StudyLength>('quick');
	let nickname = $state('');
	let soundCheck = $state<SoundCheck | null>(null);
	let played = $state(false);

	const sfx = createSfx();
	onDestroy(() => sfx.reset());

	function testTone() {
		sfx.setEnabled(true);
		sfx.wake();
		sfx.arp([523.25, 659.25, 783.99, 1046.5], 0.16, { dur: 0.22, vol: 0.5, type: 'triangle' });
		played = true;
	}

	function start() {
		if (!soundCheck) return;
		onstart({ length, nickname: nickname.trim().slice(0, 24), soundCheck });
	}
</script>

<Page width="narrow">
	<PageHeader eyebrow="Study" title="Which countdown works best?">
		<p class="lead">
			Circle Chase is a maze-chase game used for research. In each round the game may show how much
			power-up time is left in a different way, and we look at how people play around the moment it runs out.
			There are no right answers: just play to win.
		</p>
	</PageHeader>

	<div class="stack">
		<Panel title="What is recorded" level={2}>
			<ul class="list">
				<li>Anonymous gameplay only: positions, timings, scores, and your answers to a few questions.</li>
				<li>No name, account or contact details. A nickname is optional and only shown on this site.</li>
				<li>The data is stored on this machine and used to compare the signals.</li>
			</ul>
		</Panel>

		<Panel title="How long" level={2}>
			<div class="lengths" role="radiogroup" aria-label="Session length">
				<label class="choice" class:on={length === 'quick'}>
					<input type="radio" name="length" value="quick" bind:group={length} />
					<span class="t">Quick <span class="rec">recommended</span></span>
					<span class="d">{quick} rounds, about 8 minutes</span>
				</label>
				<label class="choice" class:on={length === 'full'}>
					<input type="radio" name="length" value="full" bind:group={length} />
					<span class="t">Full</span>
					<span class="d">{total} rounds, about 20 minutes</span>
				</label>
			</div>
			<p class="hint">First a 30 second practice round, then each round lasts about a minute and a half, with two quick questions after it.</p>
		</Panel>

		<Panel title="Controls" level={2}>
			<p class="controls">
				<span><Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>→</Kbd> or <Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd> to move</span>
				<span>Swipe on a touch screen</span>
				<span><Kbd>P</Kbd> to pause</span>
			</p>
			<p class="hint">Eat the dots. A power dot makes the ghosts scared for a few seconds: catch them for points, but get away before they turn back. Lives never run out, so a mistake never ends a round.</p>
		</Panel>

		<Panel title="Sound check" level={2}>
			<p>Some rounds use sound. Please turn your sound on, then play the test tone.</p>
			<div class="tone">
				<Button onclick={testTone}>{played ? 'Play it again' : 'Play test tone'}</Button>
			</div>
			<div class="answers" role="radiogroup" aria-label="Did you hear the tone?">
				<label class="opt"><input type="radio" name="sound" value="heard" bind:group={soundCheck} disabled={!played} /> I heard it</label>
				<label class="opt"><input type="radio" name="sound" value="not-heard" bind:group={soundCheck} disabled={!played} /> I did not hear it</label>
				<label class="opt"><input type="radio" name="sound" value="muted" bind:group={soundCheck} /> I will play without sound</label>
			</div>
			{#if soundCheck === 'not-heard'}
				<p class="hint warn">Check the volume and that the tab is not muted, then try again. You can also go on without sound.</p>
			{/if}
		</Panel>

		<Panel title="Nickname" sub="Optional" level={2}>
			<Field label="Nickname" hint="Shown instead of a player number. Leave empty to stay a number.">
				{#snippet children(id)}
					<input {id} class="input" bind:value={nickname} maxlength="24" autocomplete="off" placeholder="e.g. Comet" />
				{/snippet}
			</Field>
		</Panel>

		<div class="go">
			{#if error}<p class="hint warn" role="alert">{error}</p>{/if}
			{#if !soundCheck}<p class="hint">Answer the sound check to continue.</p>{/if}
			<Button variant="primary" size="lg" disabled={!soundCheck || busy} onclick={start}>
				{busy ? 'Getting ready...' : 'Start with a practice round'}
			</Button>
		</div>
	</div>
</Page>

<style>
	.lead { max-width: 62ch; margin-top: var(--space-3); color: var(--ink-dim); font-size: var(--text-lg); }
	.stack { display: flex; flex-direction: column; gap: var(--space-4); }
	.list { margin: 0; padding-left: 1.2em; display: flex; flex-direction: column; gap: var(--space-2); color: var(--ink-dim); }
	.lengths { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
	.choice {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		cursor: pointer;
	}
	.choice.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
	.choice:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
	.choice input { position: absolute; opacity: 0; pointer-events: none; }
	.t { font-weight: 700; }
	.rec { margin-left: 6px; color: var(--accent); font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
	.d { color: var(--ink-dim); font-size: var(--text-sm); }
	.hint { margin-top: var(--space-3); color: var(--ink-dim); font-size: var(--text-sm); }
	.warn { color: var(--warn); }
	.controls { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); }
	.controls :global(kbd) { margin-right: 2px; }
	.tone { margin: var(--space-3) 0; }
	.answers { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); }
	.opt { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
	.opt:has(input:disabled) { color: var(--ink-faint); cursor: default; }
	.input {
		width: 100%;
		max-width: 320px;
		height: 40px;
		padding: 0 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--rule-strong);
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
	}
	.input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
	.go { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-3) 0 var(--space-6); }
	@media (max-width: 520px) {
		.lengths { grid-template-columns: 1fr; }
		.go :global(.btn) { width: 100%; }
	}
</style>
