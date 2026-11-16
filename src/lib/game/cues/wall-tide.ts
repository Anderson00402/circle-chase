import type { Cue, CueContext, GeoBox } from '../types';
import { boardLayer } from '../render/board';
import { finalBeat, hotness, penBlock } from './shared-maze';

/**
 * 4 · Wall tide. Taking a power dot charges every wall white. The maze's own colour then floods
 * back in from the edges towards the pen as a shrinking box, so the white area still around the
 * middle is the power left. Each side of the box moves at an even pace and all four reach the
 * pen together, so the distance from the tide line to the pen is the time left.
 *
 * The box starts moving the moment the power starts (the outer wall loses its charge first) and
 * has a crisp, lit edge. In the last 2 s only the walls round the pen are still white and they
 * throb; when it runs out the pen flashes once and the tide closes over it.
 *
 * Cost: one cached picture of the board with charged walls, drawn through a rectangle clip.
 */

const CHARGED = '#ffffff';
const CHARGED_GLOW = '#9fd8ff';
const EDGE = '#e9f6ff';

/** The charged box for a fraction of the power left: the whole board at 1, the pen block at 0. */
function tideBox(k: CueContext, frac: number): GeoBox {
	const { board } = k.geo, T = k.T, pen = penBlock(k);
	// Out past the board edge so the outer line's glow is covered at the start, and just round the pen's wall at the end.
	const o = { x0: -T * 0.5, y0: -T * 0.5, x1: board.w + T * 0.5, y1: board.h + T * 0.5 };
	const i = { x0: pen.x - T * 0.2, y0: pen.y - T * 0.2, x1: pen.x + pen.w + T * 0.2, y1: pen.y + pen.h + T * 0.2 };
	const x0 = k.lerp(i.x0, o.x0, frac), y0 = k.lerp(i.y0, o.y0, frac);
	const x1 = k.lerp(i.x1, o.x1, frac), y1 = k.lerp(i.y1, o.y1, frac);
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function charged(k: CueContext) {
	const c = k.colors;
	return boardLayer(k.maze, k.T, k.dpr, c.bg, CHARGED, CHARGED_GLOW, c.door);
}

function drawTide(k: CueContext) {
	const { ctx, T, power } = k;
	const b = tideBox(k, power.frac), r = T * 0.6;
	const hot = hotness(k), beat = finalBeat(k);
	const box = new Path2D();
	box.roundRect(b.x, b.y, b.w, b.h, r);

	// Charged walls (and a faint icy floor) inside the box.
	k.clip(box, () => {
		k.drawLayer(charged(k));
		// Final warning: what is left throbs brighter on the five beats.
		if (beat > 0) k.drawLayer(k.wallLayer('#ffffff', '#ffffff'), 0.8 * beat, 'lighter');
	});

	// The tide line: a crisp lit edge that also shows across the corridors.
	ctx.save();
	ctx.shadowColor = CHARGED_GLOW;
	ctx.shadowBlur = T * 0.5 * k.dpr;
	ctx.strokeStyle = k.rgba(EDGE, 0.55 + 0.25 * hot + 0.2 * beat);
	ctx.lineWidth = Math.max(1.2, T * (0.08 + 0.04 * hot));
	ctx.stroke(box);
	ctx.restore();
	// A darker hem just outside, so the line holds on light walls and floors.
	const out = new Path2D();
	const g = Math.max(1.5, T * 0.1);
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
		'When you take a power dot every wall turns white. The maze colour then floods back in from the edges as a shrinking box, so the white area left around the middle is the power left. In the last 2 seconds only the walls round the pen are white and they throb; when the power runs out the pen flashes and the tide closes over it.',
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
