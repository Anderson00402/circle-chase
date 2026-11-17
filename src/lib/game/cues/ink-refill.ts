import type { CueContext, Cue, GhostView } from '../types';
import { carries, scaredShiver, sinceWoke, warnDepth, warnOn, wispUnit } from './shared-ghosts';

/**
 * Idea 1: each scared ghost is an empty dashed outline, and its own colour rises back up inside it
 * like liquid. How full it is is how much of the power is gone, exactly in proportion to time.
 * In the last 2 s the liquid boils (choppy surface, rising bubbles, a hot surface line); it
 * reaches the top of the head as the power ends and the wisp is solid and dangerous again.
 */

/** Seconds the "solid again" outline lasts after the power ran out. */
const SEAL = 0.35;

/** Top and bottom of the ghost body, in units of the ghost size, from its centre. */
const TOP = -0.47, BOTTOM = 0.47;

/**
 * Height of the liquid surface (from the wisp centre, in wisp units) that leaves `fill` of the
 * body's area below it. The body is round at the top and tapers to a tail, so filling by height
 * would look nearly full well before the end; filling by area keeps "half full" at half time.
 * Worked out once from the body's outline (the same curves the renderer traces, tail at rest).
 */
const levelFor = (() => {
	let rows: number[] | null = null;
	const N = 240;
	const build = () => {
		const c = document.createElement('canvas');
		c.width = c.height = N;
		const x = c.getContext('2d', { willReadFrequently: true })!;
		const t = N * 0.95, R = 0.37 * t, hy = -0.1 * t, tx = 0.22 * t, ty = 0.47 * t;
		x.translate(N / 2, N / 2);
		x.beginPath();
		x.moveTo(-R, hy);
		x.arc(0, hy, R, Math.PI, 0);
		x.bezierCurveTo(R, hy + R, tx + t * 0.12, ty - t * 0.1, tx, ty);
		x.bezierCurveTo(tx - t * 0.1, ty - t * 0.05, -R * 0.9, hy + R * 0.9, -R, hy);
		x.closePath();
		x.fillStyle = '#fff';
		x.fill();
		const d = x.getImageData(0, 0, N, N).data;
		// Area below each row, from the bottom up, as a share of the whole body.
		const area = new Array(N + 1).fill(0);
		for (let y = N - 1; y >= 0; y--) {
			let n = 0;
			for (let i = 0; i < N; i++) n += d[(y * N + i) * 4 + 3] / 255;
			area[y] = area[y + 1] + n;
		}
		const total = area[0] || 1;
		rows = area.map((a) => a / total);
	};
	return (fill: number): number => {
		if (!rows) build();
		const t = N * 0.95, r = rows!;
		if (fill <= 0) return BOTTOM;
		if (fill >= 1) return TOP;
		// First row (from the bottom) whose area below reaches `fill`.
		let y = N - 1;
		while (y > 0 && r[y] < fill) y--;
		const span = r[y] - r[y + 1] || 1, u = (fill - r[y + 1]) / span;
		return Math.max(TOP, Math.min(BOTTOM, (y + 1 - u - N / 2) / t));
	};
})();

/** Liquid surface height for a fill 0..1: by area, from the tail tip to the top of the head. */
function surfaceY(cy: number, t: number, fill: number): number {
	return cy + t * levelFor(fill);
}

function traceSurface(k: CueContext, cx: number, t: number, y: (x: number) => number) {
	const x0 = cx - t * 0.6, x1 = cx + t * 0.6, N = 14;
	k.ctx.moveTo(x0, y(x0));
	for (let n = 1; n <= N; n++) {
		const x = x0 + ((x1 - x0) * n) / N;
		k.ctx.lineTo(x, y(x));
	}
}

function drawFilling(k: CueContext, g: GhostView, i: number, cx: number, cy: number) {
	const { ctx, T, colors } = k;
	const t = wispUnit(T);
	const fill = 1 - k.power.frac;
	const warn = warnOn(k), deep = warnDepth(k);
	const still = k.reduceMotion;
	const color = colors.ghost[g.id];
	// Draws only the dashed outline and the eyes of the scared look over what is already there.
	const outline = () => k.drawGhost(g, i, 'scared', cx, cy, { color: 'rgba(0,0,0,0)', eyes: 'dark' });

	// Surface: a lazy slosh while calm, choppy and boiling in the last 2 s.
	const sy = surfaceY(cy, t, fill);
	// The waves never cover more than a third of what is still uncoloured, so the cap at the top
	// stays clearly visible until the very end: "almost", not "done".
	const cap = sy - (cy + t * TOP);
	const amp = still ? 0 : Math.min(t * (0.022 + warn * (0.035 + 0.03 * deep)), cap * 0.3);
	const kx = (Math.PI * 2) / (t * (0.95 - 0.3 * warn));
	const w = 2.2 + warn * 9;
	const y = (x: number) => sy
		+ amp * Math.sin((x - cx) * kx + k.now * w + i * 2.1)
		+ amp * 0.5 * Math.sin((x - cx) * kx * 1.9 - k.now * w * 1.4 + i);

	// 1. The empty scared ghost, exactly as the base game draws it.
	k.drawGhost(g, i, 'scared', cx, cy);
	if (fill <= 0) return;

	const body = () => k.ghostPath(g, i, cx + scaredShiver(k, i), cy, { look: 'scared' });
	const bottom = cy + t;

	// 2. Below the surface: the body filled solid in its own colour, the dashed outline drawn
	// again over it, and dark eyes once the colour reaches them.
	ctx.save();
	ctx.beginPath();
	traceSurface(k, cx, t, y);
	ctx.lineTo(cx + t * 0.6, bottom);
	ctx.lineTo(cx - t * 0.6, bottom);
	ctx.closePath();
	ctx.clip();
	body();
	ctx.fillStyle = color;
	ctx.fill();
	outline();

	// Boiling: bubbles rise from the tail to the surface (still dots with reduced motion).
	if (warn > 0 && t >= 9) {
		k.clip(body, () => {
			ctx.fillStyle = k.rgba('#ffffff', 0.8 * warn);
			const r = Math.max(0.8, t * 0.05);
			if (still) {
				for (let n = 0; n < 4; n++) {
					const bx = cx + (k.hash(n, 7) - 0.5) * t * 0.42;
					const by = k.lerp(cy + t * 0.38, sy, 0.2 + 0.6 * k.hash(n, 8));
					ctx.beginPath();
					ctx.arc(bx, by, r * (0.8 + 0.5 * k.hash(n, 9)), 0, Math.PI * 2);
					ctx.fill();
				}
				return;
			}
			const RATE = 10 + 14 * deep, LIFE = 0.42;
			for (let n = Math.floor((k.now - LIFE) * RATE); n <= Math.floor(k.now * RATE); n++) {
				const age = k.now - n / RATE;
				if (age < 0 || age > LIFE) continue;
				const u = age / LIFE;
				const bx = cx + (k.hash(n, i, 1) - 0.5) * t * 0.42 + Math.sin(age * 20 + n) * t * 0.02;
				const by = k.lerp(cy + t * 0.4, sy, k.ease.inQuad(u));
				ctx.beginPath();
				ctx.arc(bx, by, r * (0.6 + 0.6 * k.hash(n, i, 2)) * (0.6 + 0.6 * u), 0, Math.PI * 2);
				ctx.fill();
			}
		});
	}
	ctx.restore();

	// Final warning: the part still uncoloured lights up pale, so even a thin cap at the top reads
	// as "not yet" until the liquid closes over it at the very end.
	if (warn > 0) {
		k.clip(body, () => {
			ctx.beginPath();
			traceSurface(k, cx, t, y);
			ctx.lineTo(cx + t * 0.6, cy - t);
			ctx.lineTo(cx - t * 0.6, cy - t);
			ctx.closePath();
			ctx.fillStyle = k.rgba(k.mix(colors.scared, '#ffffff', 0.4), 0.85 * warn);
			ctx.fill();
		});
		// The outline and eyes stay on top of the pale cap.
		outline();
	}

	// 3. The surface line, light and clear against both the dark body and the colour; hotter and
	// thicker once it boils.
	k.clip(body, () => {
		ctx.beginPath();
		traceSurface(k, cx, t, y);
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.strokeStyle = k.rgba(colors.bg, 0.55);
		ctx.lineWidth = Math.max(1.2, t * 0.07) * (1 + 0.5 * warn) + 2;
		ctx.stroke();
		ctx.strokeStyle = k.mix(colors.scared, '#ffffff', 0.5 + 0.5 * warn);
		ctx.lineWidth = Math.max(1.2, t * 0.07) * (1 + 0.5 * warn);
		if (warn > 0) {
			ctx.shadowColor = color;
			ctx.shadowBlur = t * 0.35 * warn * k.dpr;
		}
		ctx.stroke();
	});

	// Spatter: drops jumping off the boiling surface, inside the wisp's outline.
	if (warn > 0 && !still && t >= 9) {
		k.clip(body, () => {
			ctx.fillStyle = color;
			const RATE = 12, LIFE = 0.3;
			for (let n = Math.floor((k.now - LIFE) * RATE); n <= Math.floor(k.now * RATE); n++) {
				const age = k.now - n / RATE;
				if (age < 0 || age > LIFE) continue;
				const u = age / LIFE;
				const dx = (k.hash(n, i, 3) - 0.5) * t * 0.5;
				const h = Math.min(t * (0.08 + 0.1 * deep), cap * 0.4) * (0.6 + 0.4 * k.hash(n, i, 4));
				ctx.beginPath();
				ctx.arc(cx + dx, y(cx + dx) - 4 * h * u * (1 - u), Math.max(0.7, t * 0.04), 0, Math.PI * 2);
				ctx.fill();
			}
		});
	}
}

export const inkRefill: Cue = {
	id: 'ink-refill',
	role: 'idea',
	code: '1',
	name: 'Ink refill',
	tagline: "Each scared ghost's colour rises back inside it as the power runs out.",
	description:
		"Scared ghosts start empty of colour. Their own colour rises inside them like liquid, steadily, so a ghost half full means half the time is gone. In the last 2 seconds the liquid boils and the part still empty glows pale; when the liquid reaches the top of the head the ghost is solid and dangerous again.",
	channel: 'ghosts',
	baseFlash: false,

	ghost(k, g, i, cx, cy, drawDefault) {
		if (carries(k, g)) {
			drawFilling(k, g, i, cx, cy);
			return;
		}
		drawDefault();
		// Solid again: a light outline that fades from the wisp, right where it is.
		const age = sinceWoke(k, g);
		if (age < SEAL) {
			const u = age / SEAL, t = wispUnit(k.T);
			k.ghostPath(g, i, cx, cy);
			k.ctx.lineJoin = 'round';
			k.ctx.strokeStyle = k.rgba('#ffffff', 0.9 * (1 - u));
			k.ctx.lineWidth = Math.max(1.2, t * (0.1 - 0.06 * u));
			k.ctx.stroke();
		}
	}
};
