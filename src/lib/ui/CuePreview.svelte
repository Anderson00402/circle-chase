<script lang="ts" module>
	/**
	 * One clock for every preview on the page, so all cues show the same moment at the same time
	 * and can be compared side by side. A single requestAnimationFrame loop runs only while at least
	 * one preview is on screen and playing; the browser stops it in hidden tabs.
	 */
	import type { PreviewClip as Clip } from '#lib/study/preview-scenes.ts';
	import { focusPath as fp, type FocusWindow as FW } from '#lib/replay/focus.ts';

	/**
	 * Close-up camera paths for the shared clip, one per subject: ghost cues keep the nearest scared
	 * ghost in view, player cues the player; both widen to take in the pair when it fits.
	 */
	const zoomCache = new Map<string, { clip: Clip; path: FW[] }>();
	export const ZOOM = { min: 9, max: 14 };
	function zoomPath(clip: Clip, subject: 'ghost' | 'player'): FW[] {
		const hit = zoomCache.get(subject);
		if (hit?.clip === clip) return hit.path;
		const path = fp(clip.scenes, { min: ZOOM.min, max: ZOOM.max, pad: 6, subject }, 0.22);
		zoomCache.set(subject, { clip, path });
		return path;
	}

	interface Client { tick(now: number): void }
	const active = new Set<Client>();
	let raf = 0;
	function loop(now: number) {
		raf = active.size ? requestAnimationFrame(loop) : 0;
		if (document.hidden) return;
		for (const c of active) c.tick(now);
	}
	function join(c: Client) {
		active.add(c);
		if (!raf) raf = requestAnimationFrame(loop);
	}
	function leave(c: Client) {
		active.delete(c);
	}
</script>

<script lang="ts">
	/**
	 * A live preview of one cue: the same short bot-played situation (power dot, chase, power runs
	 * out with scared ghosts still around) drawn with this cue, in a loop.
	 *
	 *   <CuePreview {cue} />                       loops while on screen (thumbnail, capped at 20 fps)
	 *   <CuePreview {cue} play="hover" />          still frame; plays while its card is hovered or focused
	 *   <CuePreview {cue} controls fps={60} />     larger, with play / pause, scrubber and "seconds left"
	 *   <CuePreview {cue} zoom />                  close up on the player and the ghost that matters
	 *
	 * "Compare at a moment" (`previewMoment`) freezes every preview at the same time left.
	 *
	 * With prefers-reduced-motion it shows a still (about 1.5 s before the end) and a play button.
	 * The scenes come from `previewClip()` (src/lib/study/preview-scenes.ts), built once per page.
	 */
	import { onMount } from 'svelte';
	import type { Cue } from '#lib/game/types.ts';
	import { SceneView } from '#lib/game/render/index.ts';
	import { indexForLeft, leftAt, previewClip, type PreviewClip } from '#lib/study/preview-scenes.ts';
	import ZoomView from '#lib/replay/ZoomView.svelte';
	import { previewMoment } from './preview-moment.svelte.ts';

	interface Props {
		cue: Cue;
		/** loop: plays whenever visible. hover: still until the card (`[data-preview-host]` or the parent) is hovered or focused. still: never moves. */
		play?: 'loop' | 'hover' | 'still';
		/** Frame rate cap for drawing. */
		fps?: number;
		/** Play / pause, scrubber and the seconds-left readout. */
		controls?: boolean;
		/** Show a window of the board that follows the chase: around the nearest scared ghost or the player. */
		zoom?: false | 'ghost' | 'player';
	}
	let { cue, play = 'loop', fps = 20, controls = false, zoom = false }: Props = $props();

	const HOLD = 0.8; // seconds the last frame stays before the loop starts again

	// Raw: the shared clip is large and read-only; a deep proxy would copy it and break identity checks.
	let clip = $state.raw<PreviewClip | null>(null);
	let index = $state(0);
	let visible = $state(false);
	let hovered = $state(false);
	let reduce = $state(false);
	/** Set by the play button (reduced motion) or the controls; null = follow `play`. */
	let userPlaying = $state<boolean | null>(null);
	let scrubbing = $state(false);
	let host: HTMLDivElement;

	/** A moment picked with "compare at a moment" freezes the preview there. */
	const frozenAt = $derived(previewMoment.left);
	const wantsMotion = $derived(
		frozenAt !== null ? false : (userPlaying ?? (play === 'loop' ? !reduce : play === 'hover' ? hovered && !reduce : false))
	);
	const running = $derived(!!clip && visible && wantsMotion && !scrubbing);
	const left = $derived(clip ? leftAt(clip, index) : NaN);
	const readout = $derived(
		Number.isNaN(left) ? 'Before the power dot' : left > 0 ? `${left.toFixed(1)} s left` : `Ran out ${(-left).toFixed(1)} s ago`
	);

	// Paused previews show the still unless someone moved them; a chosen moment wins over both.
	let moved = false;
	$effect(() => {
		if (!clip) return;
		if (frozenAt !== null) { index = indexForLeft(clip, frozenAt); userPlaying = null; moved = false; return; }
		if (!running && !moved) index = clip.stillIndex;
	});

	// Close-ups: one smoothed camera path per clip, shared by every zoomed preview.
	const path = $derived(clip && zoom ? zoomPath(clip, zoom) : null);

	let lastDraw = 0, offset = 0;
	const client: Client = {
		tick(now) {
			if (!clip || now - lastDraw < 1000 / fps - 2) return;
			lastDraw = now;
			const n = clip.scenes.length, period = n / clip.fps + HOLD;
			const t = ((now / 1000 - offset) % period + period) % period;
			index = Math.min(n - 1, Math.floor(t * clip.fps));
		}
	};
	$effect(() => {
		if (!running) return;
		moved = true;
		join(client);
		return () => leave(client);
	});

	function togglePlay() {
		if (!clip) return;
		if (previewMoment.left !== null) { previewMoment.left = null; }
		const next = !running;
		if (next && userPlaying === false) {
			// Resume from where it was paused rather than jumping to the shared clock.
			offset = performance.now() / 1000 - index / clip.fps;
		}
		userPlaying = next;
	}

	function onScrub(e: Event) {
		previewMoment.left = null;
		moved = true;
		index = +(e.currentTarget as HTMLInputElement).value;
		userPlaying = false;
	}

	onMount(() => {
		clip = previewClip();
		const mq = matchMedia('(prefers-reduced-motion: reduce)');
		reduce = mq.matches;
		const onMq = () => (reduce = mq.matches);
		mq.addEventListener('change', onMq);
		const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '80px' });
		io.observe(host);
		const card = (host.closest('[data-preview-host]') as HTMLElement | null) ?? host.parentElement ?? host;
		const on = () => (hovered = true), off = () => (hovered = false);
		const focusOut = (e: FocusEvent) => { if (!card.contains(e.relatedTarget as Node)) hovered = false; };
		card.addEventListener('pointerenter', on);
		card.addEventListener('pointerleave', off);
		card.addEventListener('focusin', on);
		card.addEventListener('focusout', focusOut);
		return () => {
			mq.removeEventListener('change', onMq);
			io.disconnect();
			card.removeEventListener('pointerenter', on);
			card.removeEventListener('pointerleave', off);
			card.removeEventListener('focusin', on);
			card.removeEventListener('focusout', focusOut);
			leave(client);
		};
	});
</script>

<div class="preview" class:controls bind:this={host}>
	<div class="stage">
		{#if clip}
			{#if path}
				<ZoomView scene={clip.scenes[index]} {cue} view={path[index]} minSize={ZOOM.min} reduceMotion={reduce} label="Close-up preview of {cue.name}" />
			{:else}
				<SceneView scene={clip.scenes[index]} {cue} fit banners={false} reduceMotion={reduce} label="Preview of {cue.name}" />
			{/if}
		{/if}
		{#if !controls && reduce && play !== 'still'}
			<button class="play-btn" onclick={togglePlay} aria-label={running ? `Pause preview of ${cue.name}` : `Play preview of ${cue.name}`}>
				<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
					{#if running}<path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor" />{:else}<path d="M6 4l10 6-10 6z" fill="currentColor" />{/if}
				</svg>
			</button>
		{/if}
	</div>
	{#if controls && clip}
		<div class="bar">
			<button class="ctl" onclick={togglePlay} aria-label={running ? 'Pause' : 'Play'}>
				<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
					{#if running}<path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor" />{:else}<path d="M6 4l10 6-10 6z" fill="currentColor" />{/if}
				</svg>
			</button>
			<input
				type="range"
				min="0"
				max={clip.scenes.length - 1}
				value={index}
				oninput={onScrub}
				onpointerdown={() => (scrubbing = true)}
				onpointerup={() => (scrubbing = false)}
				aria-label="Moment in the preview"
				aria-valuetext={readout}
				style:--start="{(clip.startIndex / (clip.scenes.length - 1)) * 100}%"
				style:--end="{(clip.endIndex / (clip.scenes.length - 1)) * 100}%"
			/>
			<span class="readout num" class:out={left <= 0} aria-live="off">{readout}</span>
		</div>
	{/if}
</div>

<style>
	.preview { width: 100%; height: 100%; display: flex; flex-direction: column; gap: var(--space-2); }
	.stage { position: relative; flex: 1; min-height: 0; }
	.stage :global(.scene-view), .stage :global(.zoom) { position: absolute; inset: 0; }
	/* Small and in a corner, so it hides as little of the board as possible. */
	.play-btn {
		position: absolute;
		right: 6px;
		top: 6px;
		width: 26px;
		height: 26px;
		opacity: 0.85;
		display: grid;
		place-items: center;
		border-radius: 50%;
		border: 1px solid var(--rule-strong);
		background: color-mix(in srgb, var(--surface) 85%, transparent);
		color: var(--ink);
		cursor: pointer;
		z-index: 2;
	}
	.bar { display: flex; align-items: center; gap: var(--space-3); }
	.ctl {
		width: 34px;
		height: 34px;
		flex: none;
		display: grid;
		place-items: center;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule-strong);
		background: var(--surface-2);
		color: var(--ink);
		cursor: pointer;
	}
	.ctl:focus-visible, .play-btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	input[type='range'] {
		flex: 1;
		min-width: 0;
		accent-color: var(--accent);
		/* The power-up's span on the track. */
		background: linear-gradient(90deg, transparent var(--start), var(--accent-soft) var(--start), var(--accent-soft) var(--end), transparent var(--end));
		border-radius: var(--radius-pill);
	}
	.readout { min-width: 15ch; text-align: right; font-size: var(--text-sm); color: var(--ink); }
	.readout.out { color: var(--bad); }
</style>
