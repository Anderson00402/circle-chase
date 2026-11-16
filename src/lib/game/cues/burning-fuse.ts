import type { Cue, CueContext } from '../types';
import { beatPeakCrossed, finalBeat, fusePath, fuseSpans, fuseToPerimeter, hotness } from './shared-maze';

/**
 * 3 · Burning fuse. The outer wall becomes a bright braided fuse that starts and ends at a small
 * charge at the top centre. A spark eats it clockwise at an even pace, so the bright stretch still
 * left (from the spark round to the charge) is the time left. What you read is the length of
 * bright wall, which shows in the corner of the eye; the spark is only the lively detail.
 *
 * The burn runs over wall only and jumps across the tunnel mouths, so the bright length is
 * honest. In the last 2 s the fuse burns hot yellow and throbs with the charge; when it runs out the
 * charge pops.
 */

const CORD = '#fffaf0';
const CORD_GLOW = '#ffb340';
const HOT = '#ffd23a';
const HOT_GLOW = '#ff7a00';
const SPARK = '#fff7da';

/** Spark position (perimeter distance) for a given number of seconds left. */
function sparkAt(k: CueContext, left: number): number {
	const f = fuseSpans(k), total = k.power.total || 1;
	return fuseToPerimeter(f, (1 - Math.min(1, Math.max(0, left / total))) * f.length);
}

function drawFuse(k: CueContext) {
	const { ctx, T, power, colors: c } = k;
	const f = fuseSpans(k), P = f.loop;
	const s = sparkAt(k, power.left);
	const hot = hotness(k), beat = finalBeat(k);
	const flick = k.reduceMotion ? 0.5 : k.noise(k.now * 16, 7);
	// The cord fills most of the outer wall's width, so its length reads from anywhere.
	const w = Math.max(2.4, T * 0.36) * (1 + 0.15 * hot);
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';

	// Burnt stretch: a thin charred cord, clearly darker than the live fuse.
	const burnt = fusePath(f, 0, s);
	ctx.strokeStyle = k.rgba(c.bg, 0.85);
	ctx.lineWidth = w * 0.9;
	ctx.stroke(burnt);
	ctx.strokeStyle = 'rgba(110,96,86,0.7)';
	ctx.lineWidth = Math.max(0.8, w * 0.22);
	ctx.setLineDash([Math.max(1, T * 0.14), Math.max(1.5, T * 0.16)]);
	ctx.stroke(burnt);
	ctx.setLineDash([]);

	// Live fuse: a dark bed (so it holds on every wall colour), a glow, the bright cord, then a
	// braid so it reads as rope even when still.
	const live = fusePath(f, s, P.length);
	const cord = k.mix(CORD, HOT, hot * (0.8 + 0.2 * flick));
	const glow = k.mix(CORD_GLOW, HOT_GLOW, hot);
	ctx.strokeStyle = k.rgba(c.bg, 0.9);
	ctx.lineWidth = w * 1.35;
	ctx.stroke(live);
	ctx.save();
	ctx.shadowColor = glow;
	ctx.shadowBlur = T * (0.5 + 0.35 * hot + 0.4 * beat) * k.dpr;
	ctx.strokeStyle = glow;
	ctx.lineWidth = w;
	ctx.stroke(live);
	ctx.restore();
	ctx.strokeStyle = cord;
	ctx.lineWidth = w * 0.72;
	ctx.stroke(live);
	if (T >= 12) {
		ctx.strokeStyle = k.rgba(k.mix(glow, '#3a1a00', 0.5), 0.5);
		ctx.lineWidth = w * 0.72;
		ctx.lineCap = 'butt';
		ctx.setLineDash([w * 0.22, w * 0.5]);
		ctx.stroke(live);
		ctx.setLineDash([]);
		ctx.lineCap = 'round';
	}
	// Final warning: the whole remaining stretch throbs with the beat.
	if (beat > 0) {
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		ctx.strokeStyle = k.rgba('#ffd2a0', 0.75 * beat);
		ctx.lineWidth = w * 1.1;
		ctx.stroke(live);
		ctx.restore();
	}

	drawCharge(k, hot, beat);
	drawSpark(k, s, hot);
}

/** The charge at the top centre where the fuse starts and ends. */
function drawCharge(k: CueContext, hot: number, beat: number) {
	const { ctx, T } = k;
	const p = fuseSpans(k).loop.pointAt(0);
	const r = Math.max(3, T * 0.36) * (1 + 0.18 * beat);
	k.glow(p.x, p.y, r * (2.6 + 1.6 * beat), k.mix(CORD_GLOW, HOT_GLOW, hot), 0.35 + 0.25 * hot + 0.4 * beat);
	ctx.fillStyle = k.mix('#2a1a10', '#5a1606', hot);
	ctx.strokeStyle = k.mix(CORD, '#ffffff', beat);
	ctx.lineWidth = Math.max(1.2, T * 0.09);
	ctx.beginPath();
	ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
	// A bright core that heats up in the last 2 s.
	ctx.fillStyle = k.mix(CORD_GLOW, '#fff4e0', 0.3 + 0.7 * beat);
	ctx.globalAlpha = 0.45 + 0.55 * Math.max(hot * 0.5, beat);
	ctx.beginPath();
	ctx.arc(p.x, p.y, r * 0.45, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalAlpha = 1;
}

/** The spark: a hot point with a spray of embers (embers dropped with reduced motion). */
function drawSpark(k: CueContext, s: number, hot: number) {
	const { ctx, T, power } = k;
	const P = fuseSpans(k).loop, p = P.pointAt(s);
	const flick = k.reduceMotion ? 0.5 : k.noise(k.now * 22, 3);
	const r = Math.max(1.6, T * 0.15) * (1 + 0.3 * hot) * (0.85 + 0.3 * flick);
	k.glow(p.x, p.y, T * (0.9 + 0.5 * hot), k.mix('#ffcf6a', HOT_GLOW, hot), 0.9);
	ctx.fillStyle = SPARK;
	ctx.beginPath();
	ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
	ctx.fill();
	if (k.reduceMotion) return;
	// Stateless embers: born on a fixed clock at the spark's position at that moment.
	const RATE = 36 + 30 * hot, LIFE = 0.42;
	for (let n = Math.floor((k.now - LIFE) * RATE); n <= Math.floor(k.now * RATE); n++) {
		const born = n / RATE, age = k.now - born;
		if (age < 0 || age > LIFE || age > power.elapsed) continue;
		const q = P.pointAt(sparkAt(k, power.left + age));
		const h1 = k.hash(n, power.serial, 1), h2 = k.hash(n, power.serial, 2);
		// Mostly into the maze and back along the burnt side, a little outwards.
		const into = (h1 - 0.3) * T * 3.2, back = -(0.4 + h2) * T * 1.6;
		const vx = q.nx * into + q.tx * back, vy = q.ny * into + q.ty * back;
		const u = age / LIFE;
		const x = q.x + vx * age, y = q.y + vy * age + T * 2.2 * age * age;
		ctx.globalAlpha = (1 - u) * 0.95;
		ctx.fillStyle = k.mix('#fff2b0', HOT, Math.min(1, u * 1.4 + hot * 0.4));
		const sz = Math.max(0.8, T * 0.07 * (1 - u * 0.6));
		ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
	}
	ctx.globalAlpha = 1;
}

/** When the fuse reaches the charge: a pop at the top centre and one flash along the whole border. */
function drawPop(k: CueContext) {
	const { ctx, T } = k;
	const t = k.power.sinceExpired, D = 0.65;
	if (!(t < D)) return;
	const u = t / D, p = fuseSpans(k).loop.pointAt(0);
	// The border flashes once and fades (one change, so it is fine with reduced motion too).
	k.drawLayer(k.wallLayer('#ffffff', HOT_GLOW, { outer: true }), 0.9 * Math.pow(1 - u, 2));
	k.glow(p.x, p.y, T * (1.6 + 3.5 * k.ease.outCubic(u)), '#ffd08a', 1 - u);
	k.ring(p.x, p.y, T * (0.4 + 4.2 * k.ease.outCubic(u)), Math.max(1.2, T * 0.22 * (1 - u)), '#fff2d0', { alpha: 1 - u });
	if (k.reduceMotion) return;
	for (let i = 0; i < 18; i++) {
		const a = Math.PI * (0.05 + 0.9 * (i / 17)) + (k.hash(i, k.power.serial) - 0.5) * 0.25;
		const d = T * (0.4 + 3.4 * k.ease.outCubic(u) * (0.6 + 0.4 * k.hash(i, 9)));
		ctx.fillStyle = k.rgba(i % 3 ? '#ffd27a' : '#ff6a3a', 1 - u);
		ctx.beginPath();
		ctx.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, Math.max(0.8, T * 0.09 * (1 - u)), 0, Math.PI * 2);
		ctx.fill();
	}
}

export const burningFuse: Cue = {
	id: 'burning-fuse',
	role: 'idea',
	code: '3',
	name: 'Burning fuse',
	tagline: 'The outer wall is a fuse; the bright part left is the time left.',
	description:
		'When you take a power dot the outer wall turns into a bright fuse and a spark starts eating it from the charge at the top. The bright stretch still to burn, round to the charge, is the power left; it burns hot and throbs in the last 2 seconds and the charge pops when it is gone.',
	channel: 'maze',
	baseFlash: false,

	under(k) {
		if (k.power.active && k.frame.phase === 'playing') drawFuse(k);
		drawPop(k);
	},

	sound(prev, f, sfx) {
		// Soft crackle while the fuse burns hot, on the same five beats as the throb.
		if (beatPeakCrossed(prev.power.left, f.power.left)) sfx.noise(0.06, { vol: 0.03, freq: 2600, q: 0.8 });
		if (f.events.some((e) => e.type === 'powerEnd' && e.reason === 'expired')) {
			sfx.noise(0.28, { vol: 0.06, freq: 220, q: 0.6 });
			sfx.tone(180, 0.22, { type: 'triangle', to: 60, vol: 0.05 });
		}
	}
};
