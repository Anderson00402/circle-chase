import type { Cue, CueContext } from '../types';
import { beatPeakCrossed, corridorPath, finalBeat, hotness } from './shared-maze';

/**
 * 10 · Dot sweep. Taking a power dot lights up the board: the corridors take on a warm glow and
 * every dot turns gold. A clock hand starts at 12 o'clock over the pen and sweeps once round the
 * board in the power's length; what it has passed goes back to normal. The lit wedge still ahead
 * of the hand, round to 12 o'clock, is the power left, like the face of a clock.
 *
 * The light is on the corridor floor, not only on the dots, so the wedge reads just as well on a
 * board the player has already emptied. The hand is drawn bright on the floor and only faintly
 * over walls and the pen, so it never covers them. In the last 2 s the remaining wedge throbs, the
 * hand turns red and the swept floor (most of the board, wherever the player is) throbs red on the
 * same five beats (a steady red glow that grows, with reduced motion); at the end the 12 o'clock
 * line flashes.
 */

const LIT = '#ffcf4d';
const LIT_DOT = '#ffe58a';
const HAND = '#fff6dc';
const HOT = '#ff4d3a';

/** Pivot: the centre of the pen, the natural middle of every maze. */
const pivot = (k: CueContext): [number, number] => [k.geo.pen.cx, k.geo.pen.cy];

/** Angle of the hand, 0 at 12 o'clock, clockwise, in radians. */
const handAngle = (k: CueContext) => (1 - k.power.frac) * Math.PI * 2;

/** Clock angle of a point (0 at 12 o'clock, clockwise, 0..2π). */
function clockAngle(cx: number, cy: number, x: number, y: number) {
	const a = Math.atan2(x - cx, cy - y);
	return a < 0 ? a + Math.PI * 2 : a;
}

/** The wedge from the hand round to 12 o'clock (the part still lit). */
function wedge(k: CueContext, from: number): Path2D {
	const [cx, cy] = pivot(k), b = k.geo.board, R = Math.hypot(b.w, b.h);
	const p = new Path2D();
	p.moveTo(cx, cy);
	p.arc(cx, cy, R, from - Math.PI / 2, Math.PI * 1.5);
	p.closePath();
	return p;
}

function drawLight(k: CueContext) {
	const { ctx, power } = k;
	const hot = hotness(k), beat = finalBeat(k);
	const a = handAngle(k);
	// A soft fade-in over the first moment so the board visibly lights up (instant with reduced motion).
	const on = k.reduceMotion ? 1 : k.smoothstep(0, 0.1, power.elapsed);
	const floor = corridorPath(k);
	k.clip(floor, () => {
		ctx.fillStyle = k.rgba(k.mix(LIT, HOT, hot * 0.35), (0.3 + 0.16 * beat) * on);
		ctx.fill(wedge(k, a));
		// Final warning where the player is: by now the lit wedge is a sliver near 12 o'clock, so
		// the dark part the hand has swept (most of the board) throbs red on the five beats.
		if (beat > 0) {
			const rest = new Path2D();
			const [cx, cy] = pivot(k), b = k.geo.board, R = Math.hypot(b.w, b.h);
			rest.moveTo(cx, cy);
			rest.arc(cx, cy, R, -Math.PI / 2, a - Math.PI / 2);
			rest.closePath();
			ctx.fillStyle = k.rgba(HOT, 0.26 * beat);
			ctx.fill(rest);
		}
	});
}

function drawDots(k: CueContext, drawDefault: () => void) {
	drawDefault();
	const { ctx, T, power } = k;
	if (!power.active || k.frame.phase !== 'playing') return;
	const [cx, cy] = pivot(k), a = handAngle(k), beat = finalBeat(k);
	const on = k.reduceMotion ? 1 : k.smoothstep(0, 0.1, power.elapsed);
	const dots = k.scene.dots, r = Math.max(1.4, T * 0.12) * (1 + 0.25 * beat);
	ctx.fillStyle = k.rgba(LIT, (0.28 + 0.25 * beat) * on);
	ctx.beginPath();
	const lit: { cx: number; cy: number }[] = [];
	for (const d of k.geo.dots) {
		if (dots[d.i] !== 1 || clockAngle(cx, cy, d.cx, d.cy) < a) continue;
		lit.push(d);
		ctx.moveTo(d.cx + r * 2.4, d.cy);
		ctx.arc(d.cx, d.cy, r * 2.4, 0, Math.PI * 2);
	}
	ctx.fill();
	ctx.fillStyle = k.mix(k.colors.dot, LIT_DOT, on);
	ctx.beginPath();
	for (const d of lit) {
		ctx.moveTo(d.cx + r, d.cy);
		ctx.arc(d.cx, d.cy, r, 0, Math.PI * 2);
	}
	ctx.fill();
}

function drawHand(k: CueContext) {
	const { ctx, T } = k;
	const [cx, cy] = pivot(k), a = handAngle(k), hot = hotness(k), beat = finalBeat(k);
	const b = k.geo.board, R = Math.hypot(b.w, b.h);
	const ex = cx + Math.sin(a) * R, ey = cy - Math.cos(a) * R;
	const color = k.mix(HAND, HOT, hot);
	const line = () => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); };
	// Faint all the way, so it reads as one line across walls and the pen.
	ctx.lineCap = 'round';
	ctx.strokeStyle = k.rgba(color, 0.3);
	ctx.lineWidth = Math.max(1, T * 0.06);
	line();
	ctx.stroke();
	// Bright on the corridors, where nothing else is drawn.
	k.clip(corridorPath(k), () => {
		ctx.shadowColor = k.mix(LIT, HOT, hot);
		ctx.shadowBlur = T * 0.5 * k.dpr;
		ctx.strokeStyle = color;
		ctx.lineWidth = Math.max(2, T * (0.16 + 0.05 * beat));
		line();
		ctx.stroke();
	});
	// Hub over the pen centre.
	k.glow(cx, cy, T * 0.8, k.mix(LIT, HOT, hot), 0.5 + 0.4 * beat);
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(cx, cy, Math.max(1.6, T * 0.14), 0, Math.PI * 2);
	ctx.fill();
}

/** At the end the hand reaches 12 o'clock: that line flashes and fades. */
function drawEnd(k: CueContext) {
	const { ctx, T } = k;
	const t = k.power.sinceExpired, D = 0.55;
	if (!(t < D)) return;
	const u = t / D, [cx, cy] = pivot(k);
	k.clip(corridorPath(k), () => {
		ctx.fillStyle = k.rgba('#ffffff', 0.18 * (1 - u));
		ctx.fillRect(0, 0, k.geo.board.w, k.geo.board.h);
		ctx.shadowColor = LIT;
		ctx.shadowBlur = T * 0.8 * k.dpr;
		ctx.strokeStyle = k.rgba('#ffffff', 1 - u);
		ctx.lineWidth = Math.max(2, T * 0.3 * (1 - u * 0.5));
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(cx, -T);
		ctx.stroke();
	});
	k.glow(cx, cy, T * (1 + 1.5 * u), '#ffffff', 0.8 * (1 - u));
}

export const dotSweep: Cue = {
	id: 'dot-sweep',
	role: 'idea',
	code: '10',
	name: 'Dot sweep',
	tagline: 'A clock hand sweeps the board; the part still lit is the time left.',
	description:
		'When you take a power dot the corridors glow and every dot turns gold. A clock hand starts at 12 o\'clock over the pen and sweeps round once, putting out the light as it passes, so the lit wedge left is the power left. In the last 2 seconds the hand turns red and the rest of the floor throbs red five times; at the end the 12 o\'clock line flashes.',
	channel: 'maze',
	baseFlash: false,

	walls(k) {
		if (k.power.active && k.frame.phase === 'playing') drawLight(k);
	},
	dots: drawDots,
	under(k) {
		if (k.power.active && k.frame.phase === 'playing') drawHand(k);
		drawEnd(k);
	},

	sound(prev, f, sfx) {
		if (beatPeakCrossed(prev.power.left, f.power.left)) sfx.tone(990, 0.05, { type: 'triangle', vol: 0.025 });
		if (f.events.some((e) => e.type === 'powerEnd' && e.reason === 'expired')) sfx.arp([1320, 990, 660], 0.06, { dur: 0.12, type: 'triangle', vol: 0.04 });
	}
};
