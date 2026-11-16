<script lang="ts">
	/**
	 * One moment in the replay browser: a still of the key frame (drawn with the real renderer and
	 * the trial's cue), the condition, the outcome and the headline numbers. The clip is fetched
	 * and decoded only when the card scrolls into view.
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { cueById } from '#lib/game/cues/index.ts';
	import { SceneView } from '#lib/game/render/index.ts';
	import { decodeClip, type EncodedClip } from '#lib/telemetry/recorder.ts';
	import { Badge, CueChip } from '#lib/ui/index.ts';
	import { sceneAt } from './interp';
	import { keyTime, type Moment } from './list';
	import { OUTCOME_LABEL, OUTCOME_TONE, ago, leftWords } from './story';

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

	const clip = useQuery(api.clips.get, () => (visible ? { id: m.clipId } : 'skip'));
	const still = $derived.by(() => {
		if (!clip.data) return null;
		try {
			const d = decodeClip(clip.data as unknown as EncodedClip);
			return d.scenes.length ? sceneAt(d.scenes, keyTime(m)) : null;
		} catch { return null; }
	});
	const cue = $derived(cueById(m.cue));
	const outcome = $derived(m.outcome as keyof typeof OUTCOME_LABEL);
	const stillLabel = $derived(
		(m.outcome === 'timely-retreat' || m.outcome === 'early-retreat') && m.turnAt !== null ? 'At the turn-away'
		: m.outcome === 'late-catch' && m.lastEatAt !== null ? 'At the late catch'
		: 'Just after the switch'
	);
	const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<a class="card" {href} bind:this={el} aria-label="{OUTCOME_LABEL[outcome]} with {cue.name}, participant {m.participant ?? 'unknown'}{m.source === 'bot' ? ', simulated' : ''}">
	<div class="thumb">
		{#if still}
			<SceneView scene={still} {cue} fit banners={false} reduceMotion={reduce} label="Still of the moment" />
		{:else}
			<div class="ph" aria-hidden="true"></div>
		{/if}
		<span class="still-tag">{stillLabel}</span>
	</div>
	<div class="body">
		<div class="row1">
			<span class="outcome {OUTCOME_TONE[outcome]}">{OUTCOME_LABEL[outcome]}</span>
			{#if m.source === 'bot'}<Badge tone="sim">Simulated</Badge>{/if}
		</div>
		<CueChip {cue} size="sm" />
		<dl>
			<div><dt>Turned away</dt><dd class="num">{m.turnLeft === null ? 'never' : leftWords(m.turnLeft)}</dd></div>
			<div><dt>At the end</dt><dd class="num">{m.endDist === null ? '-' : m.endDist.toFixed(1) + ' tiles'}</dd></div>
			{#if m.timeToCaught !== null}<div class="wide"><dt>Caught</dt><dd class="num bad">{m.timeToCaught.toFixed(1)} s after the end</dd></div>{/if}
		</dl>
		<p class="meta"><span class="num">{m.participant !== null ? `P${m.participant}` : 'P?'}</span>{m.nickname ? ` ${m.nickname}` : ''} &middot; block {m.blockIndex + 1}, trial {m.trialIndex + 1} &middot; {ago(m.createdAt, now)}</p>
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
	.thumb { position: relative; aspect-ratio: 1; background: var(--bg); padding: 8px; }
	.ph { width: 100%; height: 100%; border-radius: var(--radius-sm); background: linear-gradient(135deg, var(--surface-2), var(--bg)); }
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
</style>
