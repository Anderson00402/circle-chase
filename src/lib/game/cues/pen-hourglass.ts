import { WALL, type Cue, type CueContext, type GeoBox } from '../types';
import { beatPeakCrossed, finalBeat, hotness } from './shared-maze';

/**
 * 7 · Pen hourglass. The pen becomes an hourglass lying on its side, full of bright sand. Sand
 * runs from the left bulb through the neck into the right one at an even pace, so how full the
 * left bulb is shows the power left; it runs out exactly when the power does.
 *
 * Where it sits is worked out from each maze's pen (`glassBox`): waiting wisps sit on the pen row
 * farthest from the door, so the glass takes the other pen rows and the wall row with the door,
 * and never the row where wisps wait. Lying down, its bulbs run along the pen block's width
 * (pens are wide and flat), and it reaches one tile further into the wall on each side where that
 * wall is solid, so the level travels three to four tiles per bulb and moves visibly even at small
 * sizes. The bulbs are mostly straight sided (so the level and the amount of sand agree), the
 * glass is dark inside so the gold sand stands out on every maze theme, and the neck sits under
 * the door. In the last 2 s the frame turns white hot and the glass throbs; the last grain drops
 * at the end and the glass flashes.
 */

const SAND = '#ffc93c';
const SAND_LIGHT = '#fff0b0';
const SAND_DARK = '#c9821f';
const GLASS = '#dcefff';
const HOT = '#fff4c2';
const HOT_GLOW = '#ffb83c';
const CAP = '#f1e2c0';

interface Glass {
	box: GeoBox;
	x0: number; x1: number; y0: number; y1: number;
	neck: number; cx: number;
	top: Path2D; bottom: Path2D;
	/** Distance from the neck of the sand surface holding `amount` (0..1 of a full bulb). */
	depthFor(amount: number): number;
	/** Height of a bulb from neck to its wide end. */
	H: number;
}

const glassCache = new Map<string, Glass>();
const boxCache = new Map<string, GeoBox>();

/**
 * Where the glass lies on the board (CSS pixels), from the maze's pen: the pen rows except the one
 * where wisps wait (the row farthest from the door), plus the wall row holding the door; the full
 * width of the pen block, and one more tile on each side where those columns are solid wall.
 */
export function glassBox(k: CueContext): GeoBox {
	const { T, maze: m } = k, { pen, door } = k.geo;
	const key = `${m.id}:${m.layout ?? ''}:${T}`;
	const hit = boxCache.get(key);
	if (hit) return hit;
	const doorAbove = door.cy < pen.cy;
	// Tile rows of the glass: door row and every pen row but the waiting one.
	const pr0 = Math.round(pen.y / T), pr1 = Math.round((pen.y + pen.h) / T) - 1;
	const r0 = doorAbove ? pr0 - 1 : pr0 + 1, r1 = doorAbove ? pr1 - 1 : pr1 + 1;
	// Tile columns: the pen block, widened by one where the whole column is wall (not the border).
	let c0 = Math.round(pen.x / T) - 1, c1 = Math.round((pen.x + pen.w) / T);
	const solid = (c: number) => {
		if (c <= 0 || c >= m.W - 1) return false;
		for (let r = r0; r <= r1; r++) if (m.tiles[r * m.W + c] !== WALL) return false;
		return true;
	};
	if (solid(c0 - 1) && solid(c1 + 1)) { c0--; c1++; }
	// A small gap on the waiting side, so bobbing wisps do not sit over the sand.
	const gap = T * 0.12;
	const x = c0 * T, w = (c1 - c0 + 1) * T;
	const y = r0 * T + (doorAbove ? 0 : gap), h = (r1 - r0 + 1) * T - gap;
	const box = { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
	if (boxCache.size > 24) boxCache.clear();
	boxCache.set(key, box);
	return box;
}

/**
 * The glass is drawn upright in its own frame and turned a quarter to lie on its side, the top
 * bulb on the left: this is the upright box (same centre, width and height swapped).
 */
function uprightBox(k: CueContext): GeoBox {
	const g = glassBox(k);
	return { x: g.cx - g.h / 2, y: g.cy - g.w / 2, w: g.h, h: g.w, cx: g.cx, cy: g.cy };
}

/** Turn the context so the upright glass lies on its side, top bulb to the left. */
function lieDown(k: CueContext) {
	const g = glassBox(k);
	k.ctx.translate(g.cx, g.cy);
	k.ctx.rotate(-Math.PI / 2);
	k.ctx.translate(-g.cx, -g.cy);
}

/**
 * The glass, from one profile: half-width by distance from the neck. Mostly straight sided with a
 * rounded funnel near the neck. Sand is placed by amount (area), so a half-empty bulb really holds
 * half its sand, and because the sides are straight the level drops almost evenly too.
 */
function glass(k: CueContext): Glass {
	const T = k.T, box = uprightBox(k);
	const key = `${k.maze.id}:${box.x},${box.y},${box.w},${box.h}:${T}`;
	const hit = glassCache.get(key);
	if (hit) return hit;
	const x0 = box.x + T * 0.28, x1 = box.x + box.w - T * 0.28;
	const y0 = box.y + T * 0.34, y1 = box.y + box.h - T * 0.34;
	const cx = box.cx, neck = box.cy, H = neck - y0, HW = (x1 - x0) / 2;
	const nw = Math.max(1, T * 0.12), tf = Math.min(H * 0.5, T * 0.9), rr = Math.min(T * 0.4, H * 0.3);
	const hw = (d: number) => {
		if (d < tf) { const u = 1 - d / tf; return nw + (HW - nw) * (1 - u * u); }
		if (d > H - rr) { const v = d - (H - rr); return HW - rr + Math.sqrt(Math.max(0, rr * rr - v * v)); }
		return HW;
	};
	const N = 40, ds: number[] = [];
	for (let i = 0; i <= N; i++) ds.push((i / N) * H);
	// Sand is placed by the area you can actually see: the bulb's width less the glass outline,
	// and less the dark notch the pen door is drawn in (it crosses the bulb near the neck).
	// So the share of gold you see is the share of time left, not just the share of glass.
	const lw = Math.max(1.2, T * 0.09);
	const n = notchBox(k), g0 = glassBox(k);
	// The notch in the upright frame: across the bulb (u) and as a depth from the neck (d).
	const nu0 = -(n.y + n.h - g0.cy), nu1 = -(n.y - g0.cy), nd0 = g0.cx - (n.x + n.w), nd1 = g0.cx - n.x;
	const seen = (d: number) => {
		const half = Math.max(0, hw(d) - lw / 2);
		let w = 2 * half;
		if (n.w > 0 && d >= nd0 && d <= nd1) w -= Math.max(0, Math.min(half, nu1) - Math.max(-half, nu0));
		return Math.max(0, w);
	};
	const M = 200, as: number[] = [0];
	for (let i = 1; i <= M; i++) as.push(as[i - 1] + ((seen(((i - 1) / M) * H) + seen((i / M) * H)) / 2) * (H / M));
	// The sand never quite reaches the top of the glass.
	const fullD = H - T * 0.14;
	const areaAt = (d: number) => {
		const i = Math.min(M - 1, Math.floor((d / H) * M)), u = (d - (i / M) * H) / (H / M);
		return as[i] + (as[i + 1] - as[i]) * u;
	};
	const full = areaAt(fullD);
	const depthFor = (amount: number) => {
		const want = Math.max(0, Math.min(1, amount)) * full;
		let i = 0;
		while (i < M - 1 && as[i + 1] < want) i++;
		const span = as[i + 1] - as[i] || 1;
		return Math.min(fullD, (i / M) * H + (H / M) * ((want - as[i]) / span));
	};
	const bulb = (dir: 1 | -1) => {
		const p = new Path2D();
		for (let i = 0; i <= N; i++) { const d = ds[i]; p[i ? 'lineTo' : 'moveTo'](cx - hw(d), neck - dir * d); }
		for (let i = N; i >= 0; i--) { const d = ds[i]; p.lineTo(cx + hw(d), neck - dir * d); }
		p.closePath();
		return p;
	};
	const g: Glass = { box, x0, x1, y0, y1, neck, cx, top: bulb(1), bottom: bulb(-1), depthFor, H };
	if (glassCache.size > 24) glassCache.clear();
	glassCache.set(key, g);
	return g;
}

/**
 * The hourglass with the left bulb holding `frac` (1 full, 0 empty). `squash` scales it along its
 * length (the quick flip at the start). Drawn upright, then laid on its side.
 */
function drawGlass(k: CueContext, frac: number, hot: number, beat: number, done: boolean, squash = 1) {
	const { ctx } = k;
	ctx.save();
	lieDown(k);
	const g = glass(k), b = g.box;
	if (squash !== 1) {
		ctx.translate(b.cx, b.cy);
		ctx.scale(1, squash);
		ctx.translate(-b.cx, -b.cy);
	}
	drawUpright(k, g, frac, hot, beat, done);
	ctx.restore();
}

function drawUpright(k: CueContext, g: Glass, frac: number, hot: number, beat: number, done: boolean) {
	const { ctx, T } = k;
	const b = g.box;
	const frame = k.mix(GLASS, HOT, hot);

	// Dark backing over the pen block, so the sand stands out whatever the maze colour.
	ctx.fillStyle = k.rgba(k.colors.bg, 0.92);
	ctx.beginPath();
	ctx.roundRect(b.x + T * 0.08, b.y + T * 0.08, b.w - T * 0.16, b.h - T * 0.16, T * 0.35);
	ctx.fill();
	// The whole glass glows on the final beats.
	if (beat > 0) k.glow(b.cx, b.cy, Math.max(b.w, b.h) * 0.6, HOT_GLOW, 0.7 * beat);

	// Glass interior, faintly lit.
	ctx.fillStyle = k.rgba(frame, 0.07 + 0.08 * beat);
	ctx.fill(g.top);
	ctx.fill(g.bottom);

	const sandFill = (y: number) => {
		const gr = ctx.createLinearGradient(0, y, 0, g.y1);
		gr.addColorStop(0, SAND_LIGHT);
		gr.addColorStop(0.18, SAND);
		gr.addColorStop(1, SAND_DARK);
		return gr;
	};
	// Top sand: drains from the neck up, by amount, with a flat lit surface.
	if (frac > 0) {
		const level = g.neck - g.depthFor(frac);
		k.clip(g.top, () => {
			ctx.fillStyle = sandFill(level);
			ctx.fillRect(g.x0, level, g.x1 - g.x0, g.neck - level + 1);
			// A bright line on the surface makes the level easy to place.
			ctx.fillStyle = SAND_LIGHT;
			ctx.fillRect(g.x0, level, g.x1 - g.x0, Math.max(1, T * 0.07));
		});
	}
	// Bottom pile: what left the top, piled from the far end with a small mound under the stream.
	// Mirror of the top: the pile's flat top sits as far from the neck as the top sand's surface.
	const pileD = g.depthFor(frac);
	const base = g.neck + pileD;
	const has = frac < 1 && base < g.y1 - 0.5;
	const mound = has ? Math.min(T * 0.35, (g.y1 - base) * 0.8) : 0;
	if (has) {
		k.clip(g.bottom, () => {
			ctx.fillStyle = sandFill(base - mound);
			ctx.beginPath();
			ctx.moveTo(g.x0 - 1, g.y1 + 1);
			ctx.lineTo(g.x0 - 1, base);
			ctx.bezierCurveTo(g.cx - (g.cx - g.x0) * 0.4, base, g.cx - T * 0.6, base - mound, g.cx, base - mound);
			ctx.bezierCurveTo(g.cx + T * 0.6, base - mound, g.cx + (g.x1 - g.cx) * 0.4, base, g.x1 + 1, base);
			ctx.lineTo(g.x1 + 1, g.y1 + 1);
			ctx.closePath();
			ctx.fill();
		});
	}
	const pileTop = has ? base - mound : g.y1;

	// The stream through the neck, with falling grains (a still stream with reduced motion).
	if (!done && frac > 0) {
		ctx.strokeStyle = k.rgba(SAND_LIGHT, 0.9);
		ctx.lineWidth = Math.max(1, T * 0.07);
		ctx.beginPath();
		ctx.moveTo(g.cx, g.neck - T * 0.05);
		ctx.lineTo(g.cx, pileTop);
		ctx.stroke();
		if (!k.reduceMotion && T >= 10) {
			ctx.fillStyle = SAND_LIGHT;
			const n = 5, fall = pileTop - g.neck;
			for (let i = 0; i < n; i++) {
				const u = (k.now * 2.2 + i / n) % 1, y = g.neck + fall * u * u;
				const s = Math.max(1, T * 0.08);
				ctx.fillRect(g.cx - s / 2 + (k.hash(i, 3) - 0.5) * T * 0.08, y - s / 2, s, s);
			}
		}
	}
	// The last grain: one bright grain drops through the neck and lands as the power ends.
	const left = k.power.left;
	if (!done && left > 0 && left < 0.35) {
		const u = 1 - left / 0.35, y = k.lerp(g.neck, pileTop, u * u), r = Math.max(1.4, T * 0.11);
		k.glow(g.cx, y, T * 0.5, '#ffffff', 0.9);
		ctx.fillStyle = '#ffffff';
		ctx.beginPath();
		ctx.arc(g.cx, y, r, 0, Math.PI * 2);
		ctx.fill();
	}

	// Glass outline and the two caps.
	ctx.save();
	ctx.shadowColor = k.mix(frame, HOT_GLOW, hot);
	ctx.shadowBlur = T * (0.35 + 0.3 * hot + 0.6 * beat) * k.dpr;
	ctx.strokeStyle = frame;
	ctx.lineWidth = Math.max(1.2, T * (0.09 + 0.04 * hot + 0.05 * beat));
	ctx.stroke(g.top);
	ctx.stroke(g.bottom);
	ctx.restore();
	const capH = Math.max(2, T * 0.24);
	ctx.fillStyle = k.mix(CAP, HOT, hot * 0.8);
	ctx.beginPath();
	ctx.roundRect(b.x + T * 0.1, g.y0 - capH, b.w - T * 0.2, capH, capH / 2);
	ctx.roundRect(b.x + T * 0.1, g.y1, b.w - T * 0.2, capH, capH / 2);
	ctx.fill();
}

/** The dark notch the pen door is drawn in, on the board (CSS pixels); empty without a door. */
function notchBox(k: CueContext): GeoBox {
	const { T } = k, d = k.geo.door;
	if (!(d.w > 0 && d.h > 0)) return { x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 };
	const pad = T * 0.12, gap = T * 0.32;
	const b = d.w >= d.h
		? { x: d.x - pad, y: d.cy - gap, w: d.w + 2 * pad, h: 2 * gap }
		: { x: d.cx - gap, y: d.y - pad, w: 2 * gap, h: d.h + 2 * pad };
	return { ...b, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

/**
 * The pen door, drawn back over the glass so the player can still see where wisps come out: a
 * dark notch cut through the glass's edge and the door's own glowing bar in it.
 */
function drawDoor(k: CueContext, alpha = 1) {
	const { ctx, T } = k, d = k.geo.door;
	if (!(d.w > 0 && d.h > 0)) return;
	const across = d.w >= d.h, h = Math.max(1.5, T * 0.14), n = notchBox(k);
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.fillStyle = k.colors.bg;
	ctx.beginPath();
	ctx.roundRect(n.x, n.y, n.w, n.h, T * 0.16);
	ctx.fill();
	ctx.fillStyle = k.colors.door;
	ctx.shadowColor = k.colors.door;
	ctx.shadowBlur = T * 0.3 * k.dpr;
	ctx.beginPath();
	if (across) ctx.roundRect(d.x - T * 0.08, d.cy - h / 2, d.w + T * 0.16, h, h / 2);
	else ctx.roundRect(d.cx - h / 2, d.y - T * 0.08, h, d.h + T * 0.16, h / 2);
	ctx.fill();
	ctx.restore();
}

function drawEnd(k: CueContext) {
	const { T } = k;
	const t = k.power.sinceExpired, D = 0.6;
	if (!(t < D)) return;
	const u = t / D, b = glassBox(k), r = Math.max(b.w, b.h) / 2;
	k.ctx.globalAlpha = 1 - k.ease.inQuad(u);
	drawGlass(k, 0, 1, 0, true);
	k.ctx.globalAlpha = 1;
	drawDoor(k, 1 - k.ease.inQuad(u));
	// The glass flashes once as the last grain lands.
	k.glow(b.cx, b.cy, r * (1.2 + 0.8 * u), '#ffffff', 0.8 * (1 - u));
	if (!k.reduceMotion) {
		k.ring(b.cx, b.cy, r * (0.6 + 1.1 * k.ease.outCubic(u)), Math.max(1.2, T * 0.2 * (1 - u)), '#ffffff', { alpha: 1 - u });
	}
}

export const penHourglass: Cue = {
	id: 'pen-hourglass',
	role: 'idea',
	code: '7',
	name: 'Pen hourglass',
	tagline: 'An hourglass in the pen runs out with the power.',
	description:
		'When you take a power dot an hourglass lying on its side appears in the pen, its left bulb full of gold sand, and the sand runs into the right bulb at an even pace. It sits on the door side of the pen, away from where ghosts wait. In the last 2 seconds the glass glows white hot and throbs; the last grain drops as the power ends and the glass flashes. The pen door stays visible on top.',
	channel: 'maze',
	baseFlash: false,

	under(k) {
		const { power } = k;
		if (power.active && k.frame.phase === 'playing') {
			// A quick flip when the power starts (a squash along its length, so it stays in place).
			const e = power.elapsed, FLIP = 0.35;
			let squash = 1;
			if (!k.reduceMotion && e < FLIP) {
				const s = Math.cos(Math.PI * (1 - k.ease.outCubic(e / FLIP)));
				squash = Math.abs(s) < 0.04 ? 0.04 * Math.sign(s || 1) : s;
			}
			drawGlass(k, power.frac, hotness(k), finalBeat(k), false, squash);
			drawDoor(k);
			return;
		}
		drawEnd(k);
	},

	sound(prev, f, sfx) {
		if (beatPeakCrossed(prev.power.left, f.power.left)) sfx.tone(1320, 0.04, { type: 'sine', vol: 0.025 });
		if (f.events.some((e) => e.type === 'powerEnd' && e.reason === 'expired')) {
			sfx.tone(sfx.note('E6'), 0.4, { type: 'sine', vol: 0.045 });
			sfx.tone(sfx.note('B6'), 0.3, { type: 'sine', vol: 0.02, delay: 0.01 });
		}
	}
};
