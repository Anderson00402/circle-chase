<script lang="ts">
	/**
	 * A scene drawn so that a window of the board (a `FocusWindow`, in tiles) fills the box: the
	 * whole board is drawn at a larger tile and the box shows the part around the window. Used for
	 * case-picker thumbnails and replay stills, where the whole maze would make the player and the
	 * ghosts dots. Fills its parent.
	 */
	import type { Cue, Scene } from '../game/types';
	import { renderScene } from '../game/render/renderer';
	import type { FocusWindow } from './focus';

	interface Props {
		scene: Scene;
		cue: Cue;
		view: FocusWindow;
		reduceMotion?: boolean;
		label?: string;
		/** Cap on the device pixel ratio (thumbnails do not need 3x). */
		maxDpr?: number;
		/**
		 * The closest the view gets (tiles). The board is drawn once at that zoom and wider views are
		 * scaled down, so a view that zooms in and out never resizes the canvas. Default: `view.size`.
		 */
		minSize?: number;
	}
	let { scene, cue, view, reduceMotion, label = 'Game board, close up', maxDpr = 2, minSize }: Props = $props();

	let holder: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let box = $state<{ w: number; h: number } | null>(null);
	const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

	$effect(() => {
		const ro = new ResizeObserver(([e]) => (box = { w: e.contentRect.width, h: e.contentRect.height }));
		ro.observe(holder);
		return () => ro.disconnect();
	});

	// Drawn at the closest zoom (in quarter-pixel steps); the current view is a CSS scale of that.
	const base = $derived(Math.min(minSize ?? view.size, view.size));
	const tile = $derived(box && box.w > 0 ? Math.max(2, Math.round((Math.max(box.w, box.h) / base) * 4) / 4) : 0);
	const scale = $derived(base / view.size);
	const offset = $derived.by(() => {
		if (!box || !tile) return { x: 0, y: 0 };
		const t = tile * scale;
		const bw = scene.maze.W * t, bh = scene.maze.H * t;
		const x = Math.min(0, Math.max(box.w - bw, box.w / 2 - view.cx * t));
		const y = Math.min(0, Math.max(box.h - bh, box.h / 2 - view.cy * t));
		return { x, y };
	});

	$effect(() => {
		if (!canvas || !tile) return;
		renderScene(canvas, scene, {
			cue, tile, banners: false, dpr: Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, maxDpr),
			reduceMotion: reduceMotion ?? reduce?.matches ?? false
		});
	});
</script>

<div class="zoom" bind:this={holder}>
	<canvas bind:this={canvas} aria-label={label} style:transform="translate({offset.x}px, {offset.y}px) scale({scale})"></canvas>
</div>

<style>
	.zoom { position: relative; width: 100%; height: 100%; overflow: hidden; line-height: 0; }
	canvas { position: absolute; left: 0; top: 0; display: block; transform-origin: 0 0; }
</style>
