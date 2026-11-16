import type { CueContext, Cue, GhostView } from '../types';
import { carries, sinceWoke, WARN, warnDepth, wispUnit, wrapDx } from './shared-ghosts';

/**
 * Idea 6: no gauge at all, only body language. Scared wisps come to in three clear stages that
 * read by silhouette and motion even at small sizes:
 *
 *   dazed    squashed flat and wide, eyes shut, rocking slowly from side to side
 *   groggy   back up but still slumped, eyes open, barely swaying
 *   alert    the last 2 s, always: tall, puffed up, leaning towards the hero, shivering harder
 *            and harder, then a quick crouch just before the end
 *
 * Then they wake: a springy stretch back into their normal, dangerous selves. The first two
 * stages split the time before the final warning in half, so they scale with the power length.
 * Each stage starts with a small jolt, so a change is hard to miss. With reduced motion each stage
 * is a still pose (flat and tilted, slumped, tall and leaning) and there is no shiver.
 */

interface Pose { sx: number; sy: number; size: number; rot: number }

/** Seconds a stage change takes; the overshoot makes it a jolt. */
const JOLT = 0.22;
/** Seconds of the crouch before the snap, and of the snap itself. */
const CROUCH = 0.3, SNAP = 0.45;

/** Which stage, and seconds into it. */
function stageAt(total: number, left: number): { s: 0 | 1 | 2; since: number } {
	const elapsed = total - left, pre = Math.max(0, total - WARN);
	if (left <= WARN) return { s: 2, since: Math.min(elapsed, WARN - left) };
	if (elapsed < pre / 2) return { s: 0, since: elapsed };
	return { s: 1, since: elapsed - pre / 2 };
}

function poseOf(k: CueContext, s: 0 | 1 | 2, g: GhostView, i: number, cx: number): Pose {
	const still = k.reduceMotion;
	if (s === 0) {
		// Dazed: flat, wide, rocking (a fixed tilt when still).
		const rot = still ? (i % 2 ? 0.3 : -0.3) : 0.3 * Math.sin(k.now * 3.4 + i * 1.3);
		return { sx: 1.14, sy: 0.66, size: 1, rot };
	}
	if (s === 1) {
		// Groggy: upright but slumped, a little sway.
		return { sx: 1.06, sy: 0.84, size: 1, rot: still ? 0 : 0.06 * Math.sin(k.now * 2.2 + i) };
	}
	// Alert: tall, puffed up, leaning towards the hero.
	const dx = wrapDx(k, cx, k.playerPos()[0]);
	const lean = Math.abs(dx) > k.T * 0.3 ? Math.sign(dx) * 0.17 : 0;
	return { sx: 0.9, sy: 1.18, size: 1.1, rot: lean };
}

function drawWaking(k: CueContext, g: GhostView, i: number, cx: number, cy: number) {
	const { ctx, T } = k;
	const t = wispUnit(T), still = k.reduceMotion;
	const { s, since } = stageAt(k.power.total, k.power.left);
	let p = poseOf(k, s, g, i, cx);

	// Stage change: blend from the previous pose with an overshoot (instant when still).
	if (s > 0 && since < JOLT && !still && k.power.total - k.power.left > JOLT) {
		const q = poseOf(k, (s - 1) as 0 | 1, g, i, cx), b = k.ease.outBack(since / JOLT);
		p = { sx: k.lerp(q.sx, p.sx, b), sy: k.lerp(q.sy, p.sy, b), size: k.lerp(q.size, p.size, b), rot: k.lerp(q.rot, p.rot, b) };
	}

	let ox = 0;
	if (s === 2 && !still) {
		// Shiver that grows to the end, and the crouch just before the snap.
		const deep = warnDepth(k);
		const amp = t * (0.03 + 0.08 * deep * deep);
		ox = (Math.sin(k.now * 53 + i * 2) + Math.sin(k.now * 79 + i)) * 0.5 * amp;
		p.rot += Math.sin(k.now * 61 + i * 3) * 0.05 * deep;
		const c = k.ease.inQuad(k.clamp((CROUCH - k.power.left) / CROUCH));
		p.sy *= 1 - 0.24 * c;
		p.sx *= 1 + 0.16 * c;
	}

	const foot = t * 0.44;
	ctx.translate(cx + ox, cy + foot);
	ctx.rotate(p.rot);
	ctx.scale(p.sx * p.size, p.sy * p.size);
	k.drawGhost(g, i, 'scared', 0, -foot, { eyes: s === 0 ? 'closed' : s === 1 ? 'pale' : 'dark' });
}

export const wakingGhosts: Cue = {
	id: 'waking-ghosts',
	role: 'idea',
	code: '6',
	name: 'Ghosts waking up',
	tagline: 'Scared ghosts come to in stages and snap awake when the power ends.',
	description:
		'Scared ghosts start out dazed: flat, eyes shut, rocking. Halfway to the last 2 seconds they sit up, still slumped. In the last 2 seconds they stand tall, lean towards you and shiver harder and harder, crouch, then spring back awake and dangerous.',
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
		// Awake: spring up out of the crouch and settle, anchored at the tail.
		const u = age / SNAP, t = wispUnit(k.T), foot = t * 0.44;
		const s = k.reduceMotion ? 0 : Math.sin(u * Math.PI * 2.2) * (1 - u) * 0.34;
		k.ctx.save();
		k.ctx.translate(cx, cy + foot);
		k.ctx.scale(1 - s * 0.5, 1 + s);
		k.ctx.translate(-cx, -(cy + foot));
		drawDefault();
		k.ctx.restore();
		// A ring in the wisp's own colour bursts off it (only fades with reduced motion).
		const r = k.reduceMotion ? t * 0.6 : t * (0.4 + 0.5 * k.ease.outCubic(u));
		k.ring(cx, cy - t * 0.05, r, Math.max(1.2, t * 0.09 * (1 - u * 0.5)), k.colors.ghost[g.id], { alpha: 1 - u });
	}
};
