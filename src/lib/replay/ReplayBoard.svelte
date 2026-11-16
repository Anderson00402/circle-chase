<script lang="ts">
	/**
	 * One replay board: the real renderer drawing a scene with a cue, sized to fit its parent, with
	 * optional viewing aids on a separate canvas on top (so the board itself stays exactly what the
	 * player saw). Pure: the picture depends only on the props.
	 */
	import { renderScene } from '#lib/game/render/index.ts';
	import type { Cue, Scene } from '#lib/game/types.ts';
	import type { Target } from './target';
	import { signed } from './story';

	interface Aids {
		/** Rings around the player and the ghost they are up against. */
		highlight: boolean;
		/** A line between them. */
		line: boolean;
		/** A small "seconds left" tag over the player. */
		tag: boolean;
	}
	interface Props {
		scene: Scene;
		cue: Cue;
		aids: Aids;
		target: Target;
		/** Seconds left on the power (negative after the end), for the tag. */
		left: number;
		reduceMotion: boolean;
		label: string;
	}
	let { scene, cue, aids, target, left, reduceMotion, label }: Props = $props();

	let holder: HTMLDivElement;
	let board: HTMLCanvasElement;
	let overlay: HTMLCanvasElement;
	let box = $state({ w: 0, h: 0 });

	$effect(() => {
		const ro = new ResizeObserver(([e]) => (box = { w: e.contentRect.width, h: e.contentRect.height }));
		ro.observe(holder);
		return () => ro.disconnect();
	});

	const GHOST_VAR: Record<string, string> = { hunter: '--hunter', ambusher: '--ambusher', guard: '--guard', drifter: '--drifter' };

	$effect(() => {
		if (!box.w || !box.h || !scene) return;
		const m = scene.maze;
		const tile = Math.max(2, Math.min(box.w / m.W, box.h / m.H));
		const r = renderScene(board, scene, { cue, tile, reduceMotion, banners: true });
		drawAids(r.tile, r.dpr);
	});

	function drawAids(T: number, dpr: number) {
		const m = scene.maze, f = scene.frame;
		const w = Math.round(T * m.W * dpr), h = Math.round(T * m.H * dpr);
		if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
		overlay.style.width = T * m.W + 'px';
		overlay.style.height = T * m.H + 'px';
		const ctx = overlay.getContext('2d')!;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, w, h);
		if (!aids.highlight && !aids.line && !aids.tag) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const css = getComputedStyle(holder);
		const color = (v: string) => css.getPropertyValue(v).trim() || '#fff';
		const P = (x: number, y: number) => [(x + 0.5) * T, (y + 0.5) * T] as const;
		const [pxx, pyy] = P(f.player.x, f.player.y);
		const g = target.ghost >= 0 ? f.ghosts[target.ghost] : null;
		const gColor = target.danger ? color('--bad') : color('--scared');

		if (g && aids.line) {
			// Draw to the nearest copy of the ghost (it may be across a tunnel).
			let gx = g.x;
			if (gx - f.player.x > m.W / 2) gx -= m.W;
			else if (f.player.x - gx > m.W / 2) gx += m.W;
			const [ax, ay] = P(gx, g.y);
			ctx.save();
			ctx.setLineDash([T * 0.35, T * 0.25]);
			ctx.lineWidth = Math.max(1.5, T * 0.12);
			ctx.strokeStyle = gColor;
			ctx.globalAlpha = 0.9;
			ctx.beginPath();
			ctx.moveTo(pxx, pyy);
			ctx.lineTo(ax, ay);
			ctx.stroke();
			ctx.restore();
			if (target.dist !== null) {
				const mx = (pxx + ax) / 2, my = (pyy + ay) / 2;
				tag(ctx, `${target.dist.toFixed(1)} tiles`, mx, my, T, gColor);
			}
		}
		if (aids.highlight) {
			ring(ctx, pxx, pyy, T * 1.05, color('--player'), T);
			if (g) {
				const [gx, gy] = P(g.x, g.y);
				ring(ctx, gx, gy, T * 1.1, gColor, T);
				const name = g.id.charAt(0).toUpperCase() + g.id.slice(1);
				tag(ctx, name, gx, gy - T * 1.55, T, color(GHOST_VAR[g.id] ?? '--ink'));
			}
		}
		if (aids.tag) {
			const txt = Math.abs(left) < 0.005 ? '0.00 s' : left > 0 ? `${left.toFixed(2)} s left` : `${signed(left)} s`;
			tag(ctx, txt, pxx, pyy - T * 1.6, T, left > 0 ? color('--accent') : color('--bad'), true);
		}
	}

	function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string, T: number) {
		ctx.save();
		ctx.lineWidth = Math.max(1.5, T * 0.13);
		ctx.strokeStyle = c;
		ctx.shadowColor = c;
		ctx.shadowBlur = T * 0.6;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}

	function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, T: number, c: string, strong = false) {
		const size = Math.max(10, Math.min(16, T * (strong ? 0.62 : 0.52)));
		ctx.save();
		ctx.font = `600 ${size}px 'JetBrains Mono Variable', ui-monospace, monospace`;
		const w = ctx.measureText(text).width + size * 0.9, h = size * 1.5;
		const bx = Math.max(2, Math.min(scene.maze.W * T - w - 2, x - w / 2)), by = Math.max(2, y - h / 2);
		ctx.fillStyle = 'rgba(8, 12, 24, 0.86)';
		ctx.strokeStyle = c;
		ctx.lineWidth = 1.25;
		ctx.beginPath();
		ctx.roundRect(bx, by, w, h, h / 2);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = c;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, bx + w / 2, by + h / 2 + 0.5);
		ctx.restore();
	}
</script>

<div class="board" bind:this={holder}>
	<div class="stack">
		<canvas bind:this={board} aria-label={label}></canvas>
		<canvas bind:this={overlay} class="overlay" aria-hidden="true"></canvas>
	</div>
</div>

<style>
	.board {
		width: 100%;
		height: 100%;
		min-height: 0;
		display: grid;
		place-items: center;
		line-height: 0;
		overflow: hidden;
	}
	.stack { position: relative; }
	canvas { display: block; }
	.overlay { position: absolute; inset: 0; pointer-events: none; }
</style>
