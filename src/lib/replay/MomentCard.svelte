<script lang="ts">
	/**
	 * One moment in the replay browser: a still of the key frame (drawn with the real renderer and
	 * the trial's cue), the condition, the outcome and the headline numbers. The clip is fetched
	 * and decoded only when the card scrolls into view.
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { cueById } from '#lib/game/cues/index.ts';
	import { decodeClip, type EncodedClip } from '#lib/telemetry/recorder.ts';
	import { Badge, CueChip } from '#lib/ui/index.ts';
	import { sceneAt } from './interp';
	import { keyTime, type Moment } from './list';
	import { OUTCOME_TONE, ago, outcomeLabel } from './story';
	import { secs, turnWords } from '../outcomes';
	import { clipFitsMaze } from './layout';
	import ZoomView from './ZoomView.svelte';
	import { focusWindow } from './focus';

	interface Props {
		m: Moment;
		href: string;
		now: number;
	}
	let { m, href, now }: Props = $props();

	let el: HTMLAnchorElement;
	let visible = $state(false);
	$effect(() => {
		const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { visible = true; io.disconnect(); } }, { rootMargin: '300px' });
		io.observe(el);
		return () => io.disconnect();
	});

	const clip = useQuery(api.clips.byTrial, () => (visible ? { trialId: m.trialId } : 'skip'));
	/** The still, or 'wrong-maze' when the clip was recorded on an earlier version of the maze. */
	const still = $derived.by(() => {
		if (!clip.data) return null;
		try {
			const d = decodeClip(clip.data as unknown as EncodedClip);
			if (!clipFitsMaze(clip.data as { mazeId: string; layout?: string }, d.scenes)) return 'wrong-maze' as const;
			return d.scenes.length ? sceneAt(d.scenes, keyTime(m)) : null;
		} catch { return null; }
	});
	const scene = $derived(still && still !== 'wrong-maze' ? still : null);
	const cue = $derived(cueById(m.cue));
	const outcome = $derived(m.outcome as keyof typeof OUTCOME_TONE);
	// The still zooms on the player and the ghost that matters, so they are not dots in a whole maze.
	const view = $derived(scene ? focusWindow(scene.frame, scene.maze, { min: 11, pad: 6 }) : null);
	/** The turn-away (or the eat that ended the last chase) in the same words as everywhere else. */
	const ateLast = $derived(m.outcome === 'catch' || m.lastChaseEnd === 'eat');
	const turn = $derived(m.outcome === 'interrupted' ? '-' : m.turnLeft === null ? 'never' : (turnWords(m.outcome, m.turnLeft, m.lastChaseEnd) ?? '-').replace(/^ate it with /, ''));
	const death = $derived(m.died ? (m.outcome === 'caught' ? 'Caught' : 'Died') : null);
	const stillLabel = $derived(
		(m.outcome === 'timely-retreat' || m.outcome === 'early-retreat') && m.turnAt !== null ? 'At the turn-away'
		: (m.outcome === 'catch' || m.outcome === 'late-catch') && m.lastEatAt !== null ? 'At the catch'
		: m.outcome === 'interrupted' ? 'Just before it was cut short'
		: 'Just after the switch'
	);
	const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<a class="card" {href} bind:this={el} aria-label="{outcomeLabel(outcome)} with {cue.name}, participant {m.label ?? 'unknown'}{m.source === 'bot' ? ', simulated' : ''}{m.oldRules ? ', older rules' : ''}">
	<div class="thumb">
		{#if scene}
			<ZoomView {scene} {cue} view={view!} reduceMotion={reduce} label="Close-up still of the moment" />
		{:else if still === 'wrong-maze'}
			<div class="ph wrong"><span>Recorded on an earlier version of this maze: numbers only</span></div>
		{:else}
			<div class="ph" aria-hidden="true"></div>
		{/if}
		{#if still !== 'wrong-maze'}<span class="still-tag">{stillLabel}</span>{/if}
	</div>
	<div class="body">
		<div class="row1">
			<span class="outcome {OUTCOME_TONE[outcome]}">{outcomeLabel(outcome)}</span>
			<span class="tags">
				{#if m.oldRules}<Badge tone="warn" title="Classed by older rules: shown, but left out of the rates">Older rules</Badge>{/if}
				{#if m.source === 'bot'}<Badge tone="sim">Simulated</Badge>{/if}
			</span>
		</div>
		<CueChip {cue} size="sm" />
		<dl>
			<div><dt>{ateLast ? 'Ate the ghost' : 'Turned away'}</dt><dd class="num">{turn}</dd></div>
			<div><dt>At the end</dt><dd class="num">{m.endDist === null ? '-' : m.endDist.toFixed(1) + ' tiles'}</dd></div>
			{#if death}<div class="wide"><dt>{death}</dt><dd class="num bad">{m.diedDuring || m.endReason === 'died' ? 'while the power was on' : m.timeToCaught !== null ? `${secs(m.timeToCaught)} after the end` : 'after the end'}</dd></div>{/if}
		</dl>
		<p class="meta"><span class="num">{m.label ?? 'Unknown participant'}</span> &middot; run {m.blockIndex + 1}, power-up {m.trialIndex + 1} &middot; {ago(m.createdAt, now)}</p>
	</div>
</a>

<style>
	.card {
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-radius: var(--radius-lg);
		border: 1px solid var(--rule);
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
		overflow: hidden;
		transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
	}
	.card:hover { border-color: var(--rule-strong); transform: translateY(-1px); }
	.card:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.thumb { position: relative; min-width: 0; aspect-ratio: 1; background: var(--bg); overflow: hidden; }
	.tags { display: inline-flex; gap: 4px; }
	.ph { width: 100%; height: 100%; border-radius: var(--radius-sm); background: linear-gradient(135deg, var(--surface-2), var(--bg)); }
	.ph.wrong { display: grid; place-items: center; padding: var(--space-4); text-align: center; font-size: var(--text-xs); color: var(--ink-dim); }
	.still-tag {
		position: absolute;
		left: 8px;
		bottom: 8px;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: rgba(8, 12, 24, 0.85);
		border: 1px solid var(--rule);
		font-size: var(--text-xs);
		color: var(--ink-dim);
	}
	.body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); }
	.row1 { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
	.outcome { font-weight: 700; font-size: var(--text-md); color: var(--ink-dim); }
	.outcome.bad { color: var(--bad); }
	.outcome.good { color: var(--good); }
	.outcome.warn { color: var(--warn); }
	dl { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-1) var(--space-3); margin: 0; }
	dl .wide { grid-column: 1 / -1; }
	dt { font-size: var(--text-xs); color: var(--ink-faint); }
	dd { margin: 0; font-size: var(--text-sm); }
	dd.bad { color: var(--bad); }
	.meta { margin: 0; font-size: var(--text-xs); color: var(--ink-faint); }
	/* Phones: thumbnail beside the text, so more moments fit on a screen. */
	@media (max-width: 520px) {
		.card { flex-direction: row; }
		.thumb { flex: none; width: 128px; align-self: start; padding: 6px; }
		.still-tag { display: none; }
		.body { flex: 1; min-width: 0; padding: var(--space-2) var(--space-3); gap: 6px; }
		.row1 { flex-wrap: wrap; }
	}
</style>
