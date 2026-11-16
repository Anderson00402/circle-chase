import type { Cue, CueContext, GeoBox } from '../types';
import { boardLayer } from '../render/board';
import { finalBeat, hotness, penBlock } from './shared-maze';

/**
 * 4 · Wall tide. Taking a power dot charges every wall white. The maze's own colour then floods
 * back in from the edges towards the pen as a shrinking box, so the white area still around the
 * middle is the power left: the area between the box and the pen block is always exactly that
 * share of the area between the board edge and the pen block (half the time left, half the area).
 *
 * The charge fades in over a moment rather than flashing the whole board, the box starts moving
 * the moment the power starts and has a crisp, lit edge. In the last 2 s the tide line and the
 * board's outer border throb white on five beats (so the warning reaches the player wherever the
 * chase is), and so do the white walls left round the pen; when it runs out the pen flashes once
 * and the tide closes over it. With reduced motion the throb is a steady glow that grows instead.
 *
 * Cost: one cached picture of the board with charged walls, drawn through a rectangle clip.
 */

const CHARGED = '#ffffff';
const CHARGED_GLOW = '#9fd8ff';
const EDGE = '#e9f6ff';
/** Seconds the charge takes to come in at the start (a fade, not a flash). */
const CHARGE_IN = 0.35;
/** How strongly the charged walls cover the maze colour: just short of full, so the start is not a white-out. */
const CHARGE = 0.88;

interface Edges { x0: number; y0: number; x1: number; y1: number }

const toBox = (e: Edges): GeoBox => ({ x: e.x0, y: e.y0, w: e.x1 - e.x0, h: e.y1 - e.y0, cx: (e.x0 + e.x1) / 2, cy: (e.y0 + e.y1) / 2 });

/** Area of a box that lies on the board. */
function onBoard(e: Edges, W: number, H: number): number {
	const w = Math.min(W, e.x1) - Math.max(0, e.x0), h = Math.min(H, e.y1) - Math.max(0, e.y0);
	return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The charged box for a fraction of the power left: the whole board at 1, the pen block at 0.
 * Each edge moves by the same share `s` of its way in, and `s` is solved so that the white area
 * on the board outside the pen block is exactly `frac` of its starting size.
 */
function tideBox(k: CueContext, frac: number): GeoBox {
	const { board } = k.geo, T = k.T, pen = penBlock(k), W = board.w, H = board.h;
	// Out past the board edge so the outer line's glow is covered at the start, and just round the pen's wall at the end.
	const o: Edges = { x0: -T * 0.5, y0: -T * 0.5, x1: W + T * 0.5, y1: H + T * 0.5 };
	const i: Edges = { x0: pen.x - T * 0.2, y0: pen.y - T * 0.2, x1: pen.x + pen.w + T * 0.2, y1: pen.y + pen.h + T * 0.2 };
	const at = (s: number): Edges => ({
		x0: k.lerp(i.x0, o.x0, s), y0: k.lerp(i.y0, o.y0, s), x1: k.lerp(i.x1, o.x1, s), y1: k.lerp(i.y1, o.y1, s)
	});
	const inner = onBoard(i, W, H), want = inner + k.clamp(frac) * (onBoard(o, W, H) - inner);
	// The area grows steadily with s, so halve the interval until it is well under a pixel.
	let lo = 0, hi = 1;
	for (let n = 0; n < 24; n++) {
		const mid = (lo + hi) / 2;
		if (onBoard(at(mid), W, H) < want) lo = mid;
		else hi = mid;
	}
	return toBox(at((lo + hi) / 2));
}

function charged(k: CueContext) {
	const c = k.colors;
	return boardLayer(k.maze, k.T, k.dpr, c.bg, CHARGED, CHARGED_GLOW, c.door);
}

function drawTide(k: CueContext) {
	const { ctx, T, power } = k;
	const b = tideBox(k, power.frac), r = T * 0.6;
	const hot = hotness(k), beat = finalBeat(k);
	const charge = CHARGE * k.ease.outQuad(k.clamp(power.elapsed / CHARGE_IN));
	const box = new Path2D();
	box.roundRect(b.x, b.y, b.w, b.h, r);

	// Charged walls (and a faint icy floor) inside the box.
	k.clip(box, () => {
		k.drawLayer(charged(k), charge);
		// Final warning: what is left throbs brighter on the five beats.
		if (beat > 0) k.drawLayer(k.wallLayer('#ffffff', '#ffffff'), 0.8 * beat, 'lighter');
	});

	// Final warning near the player too: the board's outer border throbs white on the same beats.
	if (beat > 0) k.drawLayer(k.wallLayer('#ffffff', CHARGED_GLOW, { outer: true }), 0.9 * beat);

	// The tide line: a crisp lit edge that also shows across the corridors; thicker and brighter on the beats.
	ctx.save();
	ctx.shadowColor = beat > 0 ? '#ffffff' : CHARGED_GLOW;
	ctx.shadowBlur = T * (0.5 + 0.6 * beat) * k.dpr;
	ctx.strokeStyle = k.rgba(EDGE, Math.min(1, (0.55 + 0.25 * hot + 0.4 * beat) * Math.max(0.4, charge / CHARGE)));
	ctx.lineWidth = Math.max(1.2, T * (0.08 + 0.04 * hot + 0.14 * beat));
	ctx.stroke(box);
	ctx.restore();
	// A darker hem just outside, so the line holds on light walls and floors.
	const out = new Path2D();
	const g = Math.max(1.5, T * (0.1 + 0.07 * beat));
	out.roundRect(b.x - g, b.y - g, b.w + 2 * g, b.h + 2 * g, r + g);
	ctx.strokeStyle = k.rgba(k.colors.bg, 0.6);
	ctx.lineWidth = Math.max(1, T * 0.06);
	ctx.stroke(out);
}

/** When the power runs out: the pen's walls flash once and the tide line closes into the pen. */
function drawEnd(k: CueContext) {
	const { ctx, T } = k;
	const t = k.power.sinceExpired, D = 0.55;
	if (!(t < D)) return;
	const u = t / D, pen = penBlock(k);
	const pad = T * 0.25;
	const box = new Path2D();
	box.roundRect(pen.x - pad, pen.y - pad, pen.w + 2 * pad, pen.h + 2 * pad, T * 0.6);
	k.clip(box, () => k.drawLayer(k.wallLayer('#ffffff', CHARGED_GLOW), Math.pow(1 - u, 1.5)));
	k.glow(pen.cx, pen.cy, Math.max(pen.w, pen.h) * (0.7 + 0.5 * u), CHARGED_GLOW, 0.7 * (1 - u));
	if (k.reduceMotion) return;
	const s = 1 - k.ease.outCubic(u);
	const w = (pen.w + 2 * pad) * s, h = (pen.h + 2 * pad) * s;
	if (w < 1) return;
	ctx.strokeStyle = k.rgba(EDGE, 1 - u);
	ctx.lineWidth = Math.max(1.2, T * 0.12);
	ctx.beginPath();
	ctx.roundRect(pen.cx - w / 2, pen.cy - h / 2, w, h, Math.min(T * 0.6, w / 2, h / 2));
	ctx.stroke();
}

export const wallTide: Cue = {
	id: 'wall-tide',
	role: 'idea',
	code: '4',
	name: 'Wall tide',
	tagline: 'The walls turn white and their colour floods back in towards the middle.',
	description:
		'When you take a power dot the walls turn white. The maze colour then floods back in from the edges as a shrinking box, so the white area left around the middle is the power left: half the area, half the time. In the last 2 seconds the edge of the box, the white walls inside it and the outer border of the board throb white; when the power runs out the pen flashes and the box closes over it.',
	channel: 'maze',
	baseFlash: false,

	walls(k) {
		if (k.power.active && k.frame.phase === 'playing') drawTide(k);
		drawEnd(k);
	},

	sound(prev, f, sfx) {
		if (f.events.some((e) => e.type === 'powerEnd' && e.reason === 'expired')) {
			sfx.tone(880, 0.25, { type: 'sine', to: 330, vol: 0.045 });
			sfx.noise(0.3, { vol: 0.03, freq: 500, q: 0.5 });
		}
	}
};
