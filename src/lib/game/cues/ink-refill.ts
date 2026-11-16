import type { CueContext, Cue, GhostView } from '../types';
import { carries, scaredShiver, sinceWoke, warnDepth, warnOn, wispUnit } from './shared-ghosts';

/**
 * Idea 1: each scared wisp has lost its colour, and its own colour rises back up inside its body
 * like liquid. How full it is is how much of the power is gone, exactly in proportion to time.
 * In the last 2 s the liquid boils (choppy surface, rising bubbles, a hot surface line); it
 * reaches the top of the head as the power ends and the wisp is solid and dangerous again.
 */

/** Seconds the "solid again" outline lasts after the power ran out. */
const SEAL = 0.35;

/** Liquid surface height for a fill 0..1, linear from the tail tip to over the top of the head. */
function surfaceY(cy: number, t: number, fill: number, amp: number): number {
	// Top is lifted by the wave height so the head is covered completely when fill reaches 1.
	return cy + t * 0.44 + (-(t * 0.91) - amp * 1.6) * fill;
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
	const dark = k.mix(color, '#000000', 0.62);

	// Surface: a lazy slosh while calm, choppy and boiling in the last 2 s.
	const amp = still ? 0 : t * (0.022 + warn * (0.035 + 0.03 * deep));
	const kx = (Math.PI * 2) / (t * (0.95 - 0.3 * warn));
	const w = 2.2 + warn * 9;
	const sy = surfaceY(cy, t, fill, amp);
	const y = (x: number) => sy
		+ amp * Math.sin((x - cx) * kx + k.now * w + i * 2.1)
		+ amp * 0.5 * Math.sin((x - cx) * kx * 1.9 - k.now * w * 1.4 + i);

	// 1. The empty scared wisp, exactly as the base game draws it.
	k.drawGhost(g, i, 'scared', cx, cy);
	if (fill <= 0) return;

	const body = () => k.ghostPath(g, i, cx + scaredShiver(k, i), cy, { look: 'scared' });
	const bottom = cy + t;

	// 2. Below the surface: the same wisp drawn again in its own colour (face and stripes darker).
	ctx.save();
	ctx.beginPath();
	traceSurface(k, cx, t, y);
	ctx.lineTo(cx + t * 0.6, bottom);
	ctx.lineTo(cx - t * 0.6, bottom);
	ctx.closePath();
	ctx.clip();
	k.drawGhost(g, i, 'scared', cx, cy, { color, ink: dark });

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
				const h = t * (0.08 + 0.1 * deep) * (0.6 + 0.4 * k.hash(n, i, 4));
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
		"Scared ghosts start empty of colour. Their own colour rises inside them like liquid, steadily, so a ghost half full means half the time is gone. In the last 2 seconds the liquid boils, and when it reaches the top of the head the ghost is solid and dangerous again.",
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
