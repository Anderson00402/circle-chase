import type { Cue, CueContext, GeoBox } from '../types';
import { boardLayer, wallMetrics } from '../render/board';
import { finalBeat, hotness, penBlock } from './shared-maze';

/**
 * 4 · Wall tide. Taking a power dot charges every wall a bright electric yellow. The maze's own colour then floods
 * back in from the edges towards the pen as a shrinking box, so the lit walls still around the
 * middle are the power left: the length of lit wall line inside the box (outside the pen block)
 * is always that share of all of it (half the time left, half the lit walls). The box is solved
 * for wall length, not area, so mazes with many walls near the edge do not run ahead.
 *
 * The board's outer border is not part of the box: it keeps its charge everywhere and dims in
 * proportion to the time left, so a player far from the pen (the pen is off centre on some
 * mazes, and the box leaves that side first) still sees how much is left before the last 2 s.
 *
 * The charge fades in over a moment rather than flashing the whole board, the box starts moving
 * the moment the power starts and has a crisp, lit edge. In the last 2 s the tide line and the
 * board's outer border throb bright on five beats (so the warning reaches the player wherever the
 * chase is), and so do the lit walls left in the box; when it runs out the pen flashes once
 * and the tide closes over it. With reduced motion the throb is a steady glow that grows instead.
 *
 * Cost: one cached picture of the board with charged walls, drawn through a rectangle clip.
 */

/** Charged walls are a warm electric yellow: white would hardly differ from the silver maze. */
const CHARGED = '#ffe45c';
const CHARGED_GLOW = '#ffb52e';
const EDGE = '#fff6c8';
/** The final throb: a near-white warm light, so it shows on every theme including the silver one. */
const THROB = '#fff1a0';
/** Seconds the charge takes to come in at the start (a fade, not a flash). */
const CHARGE_IN = 0.35;
/** How strongly the charged walls cover the maze colour: just short of full, so the start is not a white-out. */
const CHARGE = 0.88;

interface Edges { x0: number; y0: number; x1: number; y1: number }

const toBox = (e: Edges): GeoBox => ({ x: e.x0, y: e.y0, w: e.x1 - e.x0, h: e.y1 - e.y0, cx: (e.x0 + e.x1) / 2, cy: (e.y0 + e.y1) / 2 });

/** The box at share `s` of its way out: the pen block at 0, past the whole board at 1. */
function boxAt(k: CueContext, s: number): Edges {
	const { board } = k.geo, T = k.T, pen = penBlock(k), W = board.w, H = board.h;
	// Out past the board edge so the outer line's glow is covered at the start, and just round the pen's wall at the end.
	const o: Edges = { x0: -T * 0.5, y0: -T * 0.5, x1: W + T * 0.5, y1: H + T * 0.5 };
	const i: Edges = { x0: pen.x - T * 0.2, y0: pen.y - T * 0.2, x1: pen.x + pen.w + T * 0.2, y1: pen.y + pen.h + T * 0.2 };
	return { x0: k.lerp(i.x0, o.x0, s), y0: k.lerp(i.y0, o.y0, s), x1: k.lerp(i.x1, o.x1, s), y1: k.lerp(i.y1, o.y1, s) };
}

const SAMPLES = 256;
const litCache = new Map<string, Float64Array>();

/**
 * Share of the charged walls' light (the wall layer's own pixels, glow and panels included; not
 * the outer border band, not the pen block) inside the box at s = 0, 1/SAMPLES, ... 1. Read once
 * per maze and size from the charged wall picture at one pixel per CSS pixel, summed with a
 * summed-area table so each box costs four lookups.
 */
function litTable(k: CueContext): Float64Array {
	const { T, maze: m } = k, { board } = k.geo;
	const key = `${m.id}:${m.layout ?? ''}:${T}`;
	const hit = litCache.get(key);
	if (hit) return hit;
	const W = Math.round(board.w), H = Math.round(board.h);
	const c = document.createElement('canvas');
	c.width = W;
	c.height = H;
	const x = c.getContext('2d', { willReadFrequently: true })!;
	x.drawImage(k.wallLayer(CHARGED, CHARGED_GLOW), 0, 0, W, H);
	const px = x.getImageData(0, 0, W, H).data;
	const pen = penBlock(k), { cut, lw } = wallMetrics(T), band = cut + lw / 2 + T * 0.31;
	// Summed-area table of the light that counts.
	const S = new Float64Array((W + 1) * (H + 1));
	for (let y = 0; y < H; y++) {
		let row = 0;
		for (let i = 0; i < W; i++) {
			const inPen = i >= pen.x && i < pen.x + pen.w && y >= pen.y && y < pen.y + pen.h;
			const inBand = i < band || y < band || i >= W - band || y >= H - band;
			if (!inPen && !inBand) row += px[(y * W + i) * 4 + 3] / 255;
			S[(y + 1) * (W + 1) + i + 1] = S[y * (W + 1) + i + 1] + row;
		}
	}
	const sum = (x0: number, y0: number, x1: number, y1: number) => {
		const a = Math.max(0, Math.min(W, Math.round(x0))), b = Math.max(0, Math.min(H, Math.round(y0)));
		const c2 = Math.max(0, Math.min(W, Math.round(x1))), d = Math.max(0, Math.min(H, Math.round(y1)));
		if (c2 <= a || d <= b) return 0;
		return S[d * (W + 1) + c2] - S[b * (W + 1) + c2] - S[d * (W + 1) + a] + S[b * (W + 1) + a];
	};
	// The tide line is lit too: count its light as well, about a tenth of a tile's worth per pixel
	// of line on the board (its stroke plus glow), so walls and line together track the time.
	const line = T * 0.14;
	const edge = (e: Edges) => {
		const span = (a0: number, a1: number, L: number) => Math.max(0, Math.min(L, a1) - Math.max(0, a0));
		const across = span(e.x0, e.x1, W), down = span(e.y0, e.y1, H);
		const on = (v: number, L: number) => (v >= 0 && v <= L ? 1 : 0);
		return (across * (on(e.y0, H) + on(e.y1, H)) + down * (on(e.x0, W) + on(e.x1, W))) * line;
	};
	const total = sum(0, 0, W, H) || 1;
	const table = new Float64Array(SAMPLES + 1);
	for (let n = 0; n <= SAMPLES; n++) {
		const e = boxAt(k, n / SAMPLES);
		table[n] = (sum(e.x0, e.y0, e.x1, e.y1) + edge(e)) / total;
	}
	// Never decreasing and ending at 1 (near the start the line is just leaving the board).
	table[SAMPLES] = 1;
	for (let n = 1; n <= SAMPLES; n++) table[n] = Math.min(1, Math.max(table[n], table[n - 1]));
	if (litCache.size > 24) litCache.clear();
	litCache.set(key, table);
	return table;
}

/**
 * The charged box for a fraction of the power left: the whole board at 1, the pen block at 0.
 * Each edge moves by the same share `s` of its way in, and `s` is chosen so that the share of
 * inner wall line still inside the box is `frac`.
 */
function tideBox(k: CueContext, frac: number): GeoBox {
	const t = litTable(k), want = k.clamp(frac);
	let n = 0;
	while (n < SAMPLES && t[n + 1] < want) n++;
	const span = t[n + 1] - t[n];
	const s = n >= SAMPLES ? 1 : (n + (span > 1e-9 ? (want - t[n]) / span : 0)) / SAMPLES;
	return toBox(boxAt(k, k.clamp(s)));
}

/** Everything inside the outer border band (the band the `outer` wall layer draws). */
function innerRect(k: CueContext): Path2D {
	const { T } = k, { board } = k.geo, { cut, lw } = wallMetrics(T), e = cut + lw / 2 + T * 0.31;
	const p = new Path2D();
	p.rect(e, e, board.w - 2 * e, board.h - 2 * e);
	return p;
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

	// Charged walls (and a faint icy floor) inside the box, but not the outer border.
	k.clip(box, () => k.clip(innerRect(k), () => {
		k.drawLayer(charged(k), charge);
		// Final warning: what is left throbs brighter on the five beats.
		if (beat > 0) k.drawLayer(k.wallLayer(THROB, '#ffffff'), 0.8 * beat, 'lighter');
	}));
	// The outer border keeps its charge all round and dims with the time left. Pale, like the tide
	// line, so the dimming shows even on the warm copper and red themes.
	const left = k.clamp(power.frac);
	k.drawLayer(k.wallLayer(EDGE, CHARGED_GLOW, { outer: true }), charge * left);
	// ...and a charged band along it whose thickness is the time left: full width at the start,
	// a hairline near the end, so the share left reads from anywhere on the board.
	if (left > 0) {
		ctx.save();
		ctx.lineJoin = 'round';
		ctx.strokeStyle = k.rgba(CHARGED, 0.6 * charge / CHARGE);
		ctx.shadowColor = CHARGED_GLOW;
		ctx.shadowBlur = T * 0.3 * k.dpr;
		ctx.lineWidth = T * 0.5 * left;
		ctx.stroke(k.geo.perimeter.path);
		ctx.restore();
	}

	// Final warning near the player too: the board's outer border throbs bright on the same beats.
	if (beat > 0) k.drawLayer(k.wallLayer(THROB, CHARGED_GLOW, { outer: true }), 0.95 * beat);

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
	tagline: 'The walls light up and their own colour floods back in towards the middle.',
	description:
		'When you take a power dot the walls light up yellow. The maze colour then floods back in from the edges as a shrinking box, so the lit walls left around the middle are the power left: half the lit walls, half the time. The outer border of the board stays lit all round and dims with the time left. In the last 2 seconds the edge of the box, the lit walls inside it and the outer border of the board throb bright five times; when the power runs out the pen flashes and the box closes over it.',
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
