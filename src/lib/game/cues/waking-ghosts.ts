import type { CueContext, Cue, GhostView } from '../types';
import { carries, scaredShiver, sinceWoke, WARN, warnDepth, warnOn, wispUnit, wrapDx } from './shared-ghosts';

/**
 * Idea 6: no gauge drawn beside the ghost, only the ghost's own body. Scared ghosts come to as
 * the power runs out, and two things grow steadily with the time used, so a glance says how far
 * along they are, not only which stage:
 *
 *   height   the body rises from squashed flat and wide to tall and narrow, in proportion to the
 *            time used (a quarter of the way up is a quarter of the time gone)
 *   eyes     they open in proportion too: shut at the start, half open halfway, wide at the end
 *
 * On top of that, three poses mark the stages, so a change is easy to notice:
 *
 *   dazed    rocking slowly from side to side (a fixed tilt with reduced motion)
 *   groggy   upright, barely swaying
 *   alert    the last 2 s, always: still scared (the faint body inside the blue dashes), but
 *            alarmed: the gaps between the blue dashes fill with the ghost's own colour, so the
 *            outline closes into a two-colour line; alarm marks above the head and pupils in that
 *            colour; leaning towards the hero and trembling harder and harder
 *
 * Then they wake: only now does the body take its own colour, with a springy stretch back into
 * its normal, dangerous self. Scared (blue dashes with gaps), about to wake (blue and colour
 * alternating, no gaps, alarm marks) and awake (solid colour) are three different pictures, even
 * at small sizes. The first two
 * stages split the time before the final warning in half, so they scale with the power length.
 * Each stage starts with a small hop. With reduced motion there is no rocking, shiver or hop;
 * the height, the eyes, the tilt and the danger colour carry everything.
 */

/** Body shape at the start (flat) and at the end (tall), as x and y scale. */
const FLAT = { sx: 1.18, sy: 0.6 }, TALL = { sx: 0.9, sy: 1.2 };
/** Seconds of the hop at a stage change, and of the spring awake at the end. */
const HOP = 0.24, SNAP = 0.45;

/** Which stage, and seconds into it. */
function stageAt(total: number, left: number): { s: 0 | 1 | 2; since: number } {
	const elapsed = total - left, pre = Math.max(0, total - WARN);
	if (left <= WARN) return { s: 2, since: Math.min(elapsed, WARN - left) };
	if (elapsed < pre / 2) return { s: 0, since: elapsed };
	return { s: 1, since: elapsed - pre / 2 };
}

/** Tilt of the body for each stage's pose. */
function tiltOf(k: CueContext, s: 0 | 1 | 2, i: number, cx: number): number {
	const still = k.reduceMotion;
	if (s === 0) return still ? (i % 2 ? 0.26 : -0.26) : 0.26 * Math.sin(k.now * 3.4 + i * 1.3);
	if (s === 1) return still ? 0 : 0.05 * Math.sin(k.now * 2.2 + i);
	const dx = wrapDx(k, cx, k.playerPos()[0]);
	return Math.abs(dx) > k.T * 0.3 ? Math.sign(dx) * 0.17 : 0;
}

/**
 * Eyes that open with `open` 0..1: a thin lid line when shut, a round eye in the scared blue with
 * a dark pupil when wide (light on the faint, dark scared body).
 */
function drawEyes(k: CueContext, x0: number, hy: number, t: number, open: number, socket: string, pupil: string, lookX: number) {
	const { ctx } = k;
	const rx = Math.max(1.1, t * 0.125), ry = Math.max(0.7, rx * (0.18 + 0.92 * open));
	for (const s of [-1, 1]) {
		const ex = x0 + s * t * 0.15, ey = hy + t * 0.02;
		ctx.fillStyle = socket;
		ctx.beginPath();
		ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
		ctx.fill();
		// The pupil shows once the eye is open enough to hold it, and grows with it.
		if (open > 0.3 && t >= 9) {
			ctx.fillStyle = pupil;
			ctx.beginPath();
			ctx.arc(ex + lookX * rx * 0.35, ey + ry * 0.1, Math.min(ry, rx) * 0.55, 0, Math.PI * 2);
			ctx.fill();
		}
	}
}

function drawWaking(k: CueContext, g: GhostView, i: number, cx: number, cy: number) {
	const { ctx, T, colors } = k;
	const t = wispUnit(T), still = k.reduceMotion;
	const used = k.clamp(1 - k.power.frac);
	const { s, since } = stageAt(k.power.total, k.power.left);
	const warn = warnOn(k), deep = warnDepth(k);
	const danger = colors.ghost[g.id];

	// The continuous part: height and width follow the time used exactly.
	let sx = k.lerp(FLAT.sx, TALL.sx, used), sy = k.lerp(FLAT.sy, TALL.sy, used);
	let rot = tiltOf(k, s, i, cx), ox = 0, lift = 0;

	if (!still) {
		// A small hop as each stage begins (a stretch up and back, so the shape at rest stays honest).
		if (s > 0 && since < HOP && k.power.total - k.power.left > HOP) {
			const h = Math.sin((since / HOP) * Math.PI);
			sy *= 1 + 0.14 * h;
			sx *= 1 - 0.07 * h;
			lift = t * 0.12 * h;
			// Blend the tilt from the previous pose's.
			rot = k.lerp(tiltOf(k, (s - 1) as 0 | 1, i, cx), rot, k.ease.outCubic(since / HOP));
		}
		if (s === 2) {
			// Shiver that grows to the end.
			const amp = t * (0.03 + 0.08 * deep * deep);
			ox = (Math.sin(k.now * 53 + i * 2) + Math.sin(k.now * 79 + i)) * 0.5 * amp;
			rot += Math.sin(k.now * 61 + i * 3) * 0.05 * deep;
		}
	}

	const foot = t * 0.44;
	ctx.save();
	ctx.translate(cx + ox, cy + foot - lift);
	ctx.rotate(rot);
	ctx.scale(sx, sy);
	// The body stays in the scared look to the very end; eyes are drawn below, unscaled
	// vertically by the squash, so they stay readable when flat.
	const ink = colors.scaredInk ?? colors.scared;
	k.drawGhost(g, i, 'scared', 0, -foot, { eyes: 'none' });
	const jx = scaredShiver(k, i);
	const hy = k.ghostPath(g, i, jx, -foot, { look: 'scared' });
	// Final warning: the gaps between the scared outline's blue dashes fill with the ghost's own
	// colour (the same dash rhythm, shifted by one dash), so the outline closes into a two-colour
	// line. Never a solid fill: the solid colour is kept for "awake".
	if (warn > 0) {
		ctx.lineJoin = 'round';
		ctx.setLineDash([t * 0.09, t * 0.14]);
		ctx.lineDashOffset = t * 0.09;
		ctx.strokeStyle = k.rgba(danger, warn);
		ctx.lineWidth = Math.max(1.2, t * 0.085);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.lineDashOffset = 0;
	}
	// Eyes: undo the squash so they open by their own amount, not the body's.
	if (t >= 7) {
		ctx.save();
		ctx.translate(jx, hy);
		ctx.scale(1 / sx, 1 / sy);
		const lookX = s === 2 ? Math.sign(wrapDx(k, cx, k.playerPos()[0])) : 0;
		drawEyes(k, 0, 0, t, used, ink, warn > 0 ? k.mix(colors.bg, danger, warn) : colors.bg, lookX);
		ctx.restore();
	}
	ctx.restore();
	// The top of the head, after the squash: the body's top sits 0.89 ghost units above its foot.
	if (warn > 0) drawAlarm(k, cx + ox, cy + foot - lift - t * (0.89 * sy + 0.06), t, warn, deep, danger, i);
}

/**
 * Alarm marks over the head in the final warning: three short strokes fanning upwards in the
 * ghost's own colour (a startled "!" without letters). They tremble with the body, and grow a
 * little towards the end; with reduced motion they are still.
 */
function drawAlarm(k: CueContext, x: number, top: number, t: number, warn: number, deep: number, color: string, i: number) {
	const { ctx } = k;
	const len = t * (0.2 + 0.08 * deep) * (0.6 + 0.4 * warn);
	const lw = Math.max(1.5, t * 0.08);
	const jit = k.reduceMotion ? 0 : (Math.sin(k.now * 57 + i * 1.7) * 0.5 + 0.5) * t * 0.03 * (0.4 + deep);
	ctx.lineCap = 'round';
	for (const a of [-0.62, 0, 0.62]) {
		const sx = Math.sin(a), sy = -Math.cos(a), r0 = t * 0.08 + jit;
		const x0 = x + sx * r0 * 2.2, y0 = top + sy * r0;
		// Dark keyline first so the mark reads on light walls too.
		for (const [c, w] of [[k.rgba(k.colors.bg, 0.75 * warn), lw + 2], [k.rgba(color, warn), lw]] as const) {
			ctx.strokeStyle = c;
			ctx.lineWidth = w;
			ctx.beginPath();
			ctx.moveTo(x0, y0);
			ctx.lineTo(x0 + sx * len, y0 + sy * len);
			ctx.stroke();
		}
	}
}

export const wakingGhosts: Cue = {
	id: 'waking-ghosts',
	role: 'idea',
	code: '6',
	name: 'Ghosts waking up',
	tagline: 'Scared ghosts rise from flat to tall and open their eyes as the power runs out.',
	description:
		'Scared ghosts start squashed flat with their eyes shut, rocking. As the power runs out they rise steadily and their eyes open, so a ghost halfway up means half the time is gone; halfway to the last 2 seconds they sit upright. In the last 2 seconds they stay scared but sound the alarm: the gaps in their blue outline fill with their own colour, alarm marks appear over their heads, and they lean towards you and tremble. Only when the power ends do they take their full colour and spring awake and dangerous.',
	channel: 'ghosts',
	baseFlash: false,

	ghost(k, g, i, cx, cy, drawDefault) {
		if (carries(k, g)) {
			drawWaking(k, g, i, cx, cy);
			return;
		}
		const age = sinceWoke(k, g);
		if (age >= SNAP) {
			drawDefault();
			return;
		}
		// Awake: spring up and settle, anchored at the tail.
		const u = age / SNAP, t = wispUnit(k.T), foot = t * 0.44;
		const s = k.reduceMotion ? 0 : Math.sin(u * Math.PI * 2.2) * (1 - u) * 0.34;
		k.ctx.save();
		k.ctx.translate(cx, cy + foot);
		k.ctx.scale(1 - s * 0.5, 1 + s);
		k.ctx.translate(-cx, -(cy + foot));
		drawDefault();
		k.ctx.restore();
		// A ring in the ghost's own colour bursts off it (only fades with reduced motion).
		const r = k.reduceMotion ? t * 0.6 : t * (0.4 + 0.5 * k.ease.outCubic(u));
		k.ring(cx, cy - t * 0.05, r, Math.max(1.2, t * 0.09 * (1 - u * 0.5)), k.colors.ghost[g.id], { alpha: 1 - u });
	}
};
