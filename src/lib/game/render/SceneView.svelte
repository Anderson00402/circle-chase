<script lang="ts">
	/**
	 * Draws one Scene, nothing else: no loop, no input. Redraws whenever `scene`, `cue` or the size
	 * changes. Used by replays, thumbnails and the cue gallery.
	 *
	 *   <SceneView {scene} {cue} width={240} />        fits 240 CSS pixels wide
	 *   <SceneView {scene} {cue} tile={12} />          12 CSS pixels per tile
	 *   <SceneView {scene} {cue} fit />                fills its parent's width (and height, if set)
	 */
	import type { Cue, Scene } from '../types';
	import { renderScene } from './renderer';

	interface Props {
		scene: Scene;
		cue: Cue;
		tile?: number;
		width?: number;
		height?: number;
		/** Size to the parent element instead of `width` / `height`. */
		fit?: boolean;
		reduceMotion?: boolean;
		/** Draw READY / CLEAR / GAME OVER banners. */
		banners?: boolean;
		readyLabel?: string;
		label?: string;
	}
	let { scene, cue, tile, width, height, fit = false, reduceMotion, banners = true, readyLabel, label = 'Game board' }: Props = $props();

	let canvas: HTMLCanvasElement;
	let box = $state<{ w: number; h: number } | null>(null);
	let holder: HTMLDivElement;

	const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

	$effect(() => {
		if (!fit || !holder) return;
		const ro = new ResizeObserver(([e]) => (box = { w: e.contentRect.width, h: e.contentRect.height || Infinity }));
		ro.observe(holder);
		return () => ro.disconnect();
	});

	$effect(() => {
		if (!canvas || !scene) return;
		const w = fit ? box?.w : width, h = fit ? box?.h : height;
		if (fit && !w) return;
		renderScene(canvas, scene, {
			cue, tile, width: w, height: h === Infinity ? undefined : h, banners, readyLabel,
			reduceMotion: reduceMotion ?? reduce?.matches ?? false
		});
	});
</script>

<div class="scene-view" class:fit bind:this={holder}>
	<canvas bind:this={canvas} aria-label={label}></canvas>
</div>

<style>
	.scene-view { line-height: 0; }
	.scene-view.fit { width: 100%; height: 100%; display: grid; place-items: center; }
	canvas { display: block; }
</style>
