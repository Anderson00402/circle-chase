import type { Cue, CueContext, GeoBox } from '../types';
import { beatPeakCrossed, finalBeat, hotness, penBlock } from './shared-maze';

/**
 * 7 · Pen hourglass. The whole pen block (its floor and the wall round it) becomes a wide
 * hourglass full of bright sand. The sand's top level drops at an even pace, so how full the top
 * bulb is shows the power left; it runs out exactly when the power does.
 *
 * Built to be seen from across the board: it fills the full width of the pen block, the bulbs are
 * mostly straight sided (so the level and the amount of sand agree), the glass is dark inside so
 * the gold sand stands out on every maze theme, and waiting wisps sit in the lower bulb, so the
 * top bulb you read stays clear. In the last 2 s the frame turns white hot and the pen throbs; the
 * last grain drops at the end and the glass flashes.
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

/**
 * The glass, from one profile: half-width by distance from the neck. Mostly straight sided with a
 * rounded funnel near the neck. Sand is placed by amount (area), so a half-empty bulb really holds
 * half its sand, and because the sides are straight the level drops almost evenly too.
 */
function glass(k: CueContext): Glass {
	const T = k.T, box = penBlock(k);
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
	const N = 40, ds: number[] = [], area: number[] = [0];
	for (let i = 0; i <= N; i++) ds.push((i / N) * H);
	for (let i = 1; i <= N; i++) area.push(area[i - 1] + (hw(ds[i - 1]) + hw(ds[i])) * (ds[i] - ds[i - 1]));
	// The sand never quite reaches the top of the glass.
	const fullD = H - T * 0.14;
	const areaAt = (d: number) => {
		const i = Math.min(N - 1, Math.floor((d / H) * N)), u = (d - ds[i]) / (ds[i + 1] - ds[i]);
		return area[i] + (area[i + 1] - area[i]) * u;
	};
	const full = areaAt(fullD);
	const depthFor = (amount: number) => {
		const want = Math.max(0, Math.min(1, amount)) * full;
		let i = 0;
		while (i < N - 1 && area[i + 1] < want) i++;
		const span = area[i + 1] - area[i] || 1;
		return Math.min(fullD, ds[i] + (ds[i + 1] - ds[i]) * ((want - area[i]) / span));
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

/** The hourglass with the top bulb holding `frac` (1 full, 0 empty). */
function drawGlass(k: CueContext, frac: number, hot: number, beat: number, done: boolean) {
	const { ctx, T } = k;
	const g = glass(k), b = g.box;
	const frame = k.mix(GLASS, HOT, hot);

	// Dark backing over the pen block, so the sand stands out whatever the maze colour.
	ctx.fillStyle = k.rgba(k.colors.bg, 0.92);
	ctx.beginPath();
	ctx.roundRect(b.x + T * 0.08, b.y + T * 0.08, b.w - T * 0.16, b.h - T * 0.16, T * 0.35);
	ctx.fill();
	// The whole pen glows on the final beats.
	if (beat > 0) k.glow(b.cx, b.cy, b.w * 0.8, HOT_GLOW, 0.7 * beat);

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

function drawEnd(k: CueContext) {
	const { T } = k;
	const t = k.power.sinceExpired, D = 0.6;
	if (!(t < D)) return;
	const u = t / D, b = penBlock(k);
	k.ctx.globalAlpha = 1 - k.ease.inQuad(u);
	drawGlass(k, 0, 1, 0, true);
	k.ctx.globalAlpha = 1;
	// The glass flashes once as the last grain lands.
	k.glow(b.cx, b.cy, b.w * (0.6 + 0.4 * u), '#ffffff', 0.8 * (1 - u));
	if (!k.reduceMotion) {
		k.ring(b.cx, b.cy, b.w * (0.3 + 0.55 * k.ease.outCubic(u)), Math.max(1.2, T * 0.2 * (1 - u)), '#ffffff', { alpha: 1 - u });
	}
}

export const penHourglass: Cue = {
	id: 'pen-hourglass',
	role: 'idea',
	code: '7',
	name: 'Pen hourglass',
	tagline: 'The pen in the middle becomes an hourglass that runs out with the power.',
	description:
		'When you take a power dot the pen in the middle turns into an hourglass full of gold sand, and the top runs down at an even pace. In the last 2 seconds the glass glows white hot and the whole pen throbs; the last grain drops as the power ends and the glass flashes.',
	channel: 'maze',
	baseFlash: false,

	under(k) {
		const { ctx, power } = k;
		if (power.active && k.frame.phase === 'playing') {
			// A quick flip when the power starts (a squash, so it stays inside the pen block).
			const e = power.elapsed, FLIP = 0.35;
			const flipping = !k.reduceMotion && e < FLIP;
			if (flipping) {
				const b = penBlock(k), s = Math.cos(Math.PI * (1 - k.ease.outCubic(e / FLIP)));
				ctx.translate(b.cx, b.cy);
				ctx.scale(1, Math.abs(s) < 0.04 ? 0.04 * Math.sign(s || 1) : s);
				ctx.translate(-b.cx, -b.cy);
			}
			drawGlass(k, power.frac, hotness(k), finalBeat(k), false);
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
