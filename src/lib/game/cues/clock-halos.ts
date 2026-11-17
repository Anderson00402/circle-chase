import type { CueContext, Cue, GhostView } from '../types';
import { carries, sinceWoke, WARN, warnOn, wrapDx } from './shared-ghosts';

/**
 * Idea 2: every scared ghost wears a ring that empties like a clock face. The bright part is the
 * time left; it is eaten clockwise from 12 o'clock, so the gap grows like a clock hand sweeping
 * round. The ring hugs the ghost and stays inside one tile. In the last 2 s what is left turns hot
 * orange, thickens and beats five times (the last beat ends with the power); when it closes a
 * ring snaps outward from the wisp.
 */

/** Seconds the closing snap lasts after the power ran out. */
const SNAP = 0.4;
/** Five beats in the final warning, the last ending with the power. */
const BEAT = WARN / 5;

/** Ring centre and size around a wisp at tile size T. */
function haloGeo(T: number, cy: number) {
	return { y: cy - T * 0.04, R: T * 0.5, w: Math.max(1.6, T * 0.12) };
}

/** True when a scared wisp drawn after this one sits close enough that its ring covers this one. */
function covered(k: CueContext, g: GhostView, i: number): boolean {
	const [x, y] = k.ghostPos(g);
	return k.frame.ghosts.some((o, j) => {
		if (j <= i || !carries(k, o)) return false;
		const [ox, oy] = k.ghostPos(o);
		return Math.hypot(wrapDx(k, x, ox), oy - y) < k.T * 0.9;
	});
}

function drawHalo(k: CueContext, g: GhostView, i: number, cx: number, cy: number) {
	const { ctx, T, colors } = k;
	const { y, R, w } = haloGeo(T, cy);
	const frac = k.power.frac, left = k.power.left;
	const warn = warnOn(k);
	// Beat: a sharp swell that fades, five times in the last 2 s (steady with reduced motion).
	const beat = k.reduceMotion || left > WARN ? 0 : Math.pow(1 - ((WARN - left) % BEAT) / BEAT, 2.5);
	// Calm: the scared blue lifted toward white, so the ring stands apart from the dashed blue
	// outline of the ghost inside it. Hot orange in the final warning.
	const live = k.mix(k.mix(colors.scared, '#ffffff', 0.35), colors.accent, warn);
	const TAU = Math.PI * 2, hand = (1 - frac) * TAU;

	ctx.save();
	if (covered(k, g, i)) ctx.globalAlpha = 0.3;
	ctx.lineCap = 'butt';

	// Dark track under the whole ring: separates it from walls and dots, and is the "used" slot.
	k.ring(cx, y, R, w + 2.5, colors.bg, { alpha: 0.85 });
	// The used part: a thin dim line, so the empty slot still reads as part of the dial.
	k.ring(cx, y, R, Math.max(1, w * 0.3), colors.inkDim, { alpha: 0.45, from: 0, to: hand });

	// The time left, from the hand clockwise to 12 o'clock.
	if (frac > 0) {
		const width = w * (1 + 0.35 * warn + 0.55 * beat);
		ctx.save();
		ctx.shadowColor = live;
		ctx.shadowBlur = T * (0.25 + 0.35 * warn + 0.4 * beat) * k.dpr;
		k.ring(cx, y, R, width, k.mix(live, '#ffffff', 0.25 * beat), { from: hand, to: TAU });
		ctx.restore();
		// Round knob on the moving end so the direction of travel is plain.
		if (frac < 0.995) {
			const a = hand - Math.PI / 2;
			ctx.fillStyle = k.mix(live, '#ffffff', 0.35);
			ctx.beginPath();
			ctx.arc(cx + Math.cos(a) * R, y + Math.sin(a) * R, width * 0.62, 0, TAU);
			ctx.fill();
		}
	}

	// 12 o'clock: a fixed notch across the ring, where it starts and where it will close.
	ctx.strokeStyle = colors.ink;
	ctx.lineWidth = Math.max(1, w * 0.38);
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(cx, y - R - w * 0.95);
	ctx.lineTo(cx, y - R + w * 0.95);
	ctx.stroke();
	ctx.restore();
}

export const clockHalos: Cue = {
	id: 'clock-halos',
	role: 'idea',
	code: '2',
	name: 'Clock halos',
	tagline: 'Each scared ghost wears a ring that empties like a clock.',
	description:
		'Every scared ghost wears a bright ring. A gap opens at 12 o\'clock and sweeps clockwise like a clock hand as the power drains. In the last 2 seconds what is left turns orange and beats five times, and when the ring closes it snaps outward and the ghost is dangerous again.',
	channel: 'ghosts',
	baseFlash: false,

	ghost(k, g, i, cx, cy, drawDefault) {
		drawDefault();
		if (carries(k, g)) {
			drawHalo(k, g, i, cx, cy);
			return;
		}
		// Closed: a ring snaps outward from the wisp (only fades with reduced motion).
		const age = sinceWoke(k, g);
		if (age < SNAP) {
			const u = age / SNAP, { y, R, w } = haloGeo(k.T, cy);
			const r = k.reduceMotion ? R : R * (1 + 0.7 * k.ease.outCubic(u));
			k.ring(cx, y, r, w * (1.4 - 0.9 * u), k.mix(k.colors.accent, '#ffffff', 0.3), { alpha: 1 - u });
		}
	}
};
