import type { Cue, CueContext } from '../types';
import { expiredNow, HOT, justExpired, powered, WARN } from './shared-screen';

/**
 * Heartbeat: while powered, the floor along the edges of the board glows and beats "lub-dub".
 *
 * The tempo has three clear steps rather than a smooth ramp, so a player can tell them apart:
 *   more than 4 s left   60 per minute, pale ice     (calm)
 *   4 s to 2 s left      90 per minute, yellow amber (getting low)
 *   last 2 s            150 per minute, heart red    (about to end)
 * Beats are counted back from the end of the power, not forward from its start, so whatever the
 * length the last 2 s always hold the same five fast beats and the fifth, a single big one, lands
 * exactly as the power runs out. The sound hook fires a low thump on the same beat times.
 *
 * The glow lights only the floor (never the walls) and is drawn under the dots and characters,
 * so nothing at the edges is covered. With reduced motion the beat stops flashing: the glow holds
 * a steady brightness and colour for each step instead, and the sound still beats.
 */

/** Tempo steps: beats this far apart (s) while the beat itself is at or below `upTo` seconds left. */
/** Each step is also brighter and reaches further in from the edge (`depth`, tiles), so the steps
 * differ by more than their colour. */
/**
 * The middle step: a yellow amber, far in hue from the blue walls and from the red last step, and
 * clearly brighter than calm even between beats.
 */
const MID = '#ffd640';
/**
 * The calm step: the shared pale ice lifted toward white, so its glow does not melt into the glow
 * of the blue walls beside it.
 */
const CALM_GLOW = '#e2efff';
const STEPS = [
	{ upTo: WARN, period: 0.4, color: HOT, base: 0.5, peak: 1, dub: 0.13, rm: 0.95, depth: 3.6 },
	{ upTo: 4, period: 2 / 3, color: MID, base: 0.55, peak: 1, dub: 0.2, rm: 0.75, depth: 3 },
	{ upTo: Infinity, period: 1, color: CALM_GLOW, base: 0.28, peak: 0.7, dub: 0.24, rm: 0.35, depth: 2.3 }
];
type Step = (typeof STEPS)[number];
const EPS = 1e-6;
const stepAt = (left: number): Step => STEPS.find((s) => left <= s.upTo + EPS)!;

/**
 * Every beat as "seconds left when it lands", counted back from the end: 0 (the final beat),
 * 0.4 ... 2.0, then 2.67, 3.33, 4.0, then 5, 6 ... A fixed table: it does not depend on the power.
 */
const BEATS: number[] = [
	...[0, 1, 2, 3, 4, 5].map((n) => n * 0.4),
	...[1, 2, 3].map((n) => 2 + (n * 2) / 3),
	...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => 4 + n)
];

/** Beats that belong to a power of this length (the very start is not a beat: the pickup is). */
const beatsOf = (total: number) => BEATS.filter((b) => b > 0 && b < total - 0.05);

/** A beat's shape: a quick swell, then a soft fade. */
const shape = (t: number, fade: number) => (t < 0 ? 0 : t < 0.035 ? t / 0.035 : Math.exp(-(t - 0.035) / fade));

const FINAL = 0.6; // seconds the last big beat takes to die away

/** The floor near the board's edges, white, strongest at the edge (cached; tinted per frame). */
function band(k: CueContext, depth: number) {
	const T = k.T;
	return k.layer(`heartbeat-band-${depth}`, (c) => {
		const { w, h } = k.geo.board;
		const d = T * depth, edge = T * 0.9; // from just inside the outer wall to `depth` tiles in
		const sides: [number, number, number, number, number, number, number, number][] = [
			[0, 0, 0, d, 0, 0, w, d],
			[0, h, 0, h - d, 0, h - d, w, d],
			[0, 0, d, 0, 0, 0, d, h],
			[w, 0, w - d, 0, w - d, 0, d, h]
		];
		for (const [x0, y0, x1, y1, rx, ry, rw, rh] of sides) {
			const g = c.createLinearGradient(x0, y0, x1, y1);
			const e = edge / d;
			g.addColorStop(0, 'rgba(255,255,255,0.9)');
			g.addColorStop(e, 'rgba(255,255,255,0.9)');
			g.addColorStop(e + (1 - e) * 0.35, 'rgba(255,255,255,0.4)');
			g.addColorStop(1, 'rgba(255,255,255,0)');
			c.fillStyle = g;
			c.fillRect(rx, ry, rw, rh);
		}
		// Cut the walls out, so only the floor lights up.
		c.save();
		c.setTransform(1, 0, 0, 1, 0, 0);
		c.globalCompositeOperation = 'destination-out';
		c.drawImage(k.wallMask(), 0, 0);
		c.restore();
	});
}

/** Lights the edge floor in `color` at `strength` 0..1. */
function light(k: CueContext, depth: number, color: string, strength: number) {
	if (strength <= 0.004) return;
	const { x, y, w, h } = k.geo.board;
	k.masked(band(k, depth), (c) => {
		c.fillStyle = color;
		c.fillRect(x, y, w, h);
	}, Math.min(1, strength));
}

export const heartbeat: Cue = {
	id: 'heartbeat',
	role: 'idea',
	code: '5',
	name: 'Heartbeat',
	tagline: 'The edges of the board beat like a heart that races as the power runs out.',
	description:
		'While you are powered, the floor along the edges of the board glows and beats like a heart, with a low thump you can hear. It beats slow and pale at first; below 4 seconds it beats faster in amber yellow and the glow reaches further in; in the last 2 seconds it races in red, deeper still. One big beat lands as the power ends.',
	channel: 'screen',
	baseFlash: false,

	walls(k) {
		const { power } = k;
		if (powered(k)) {
			const left = power.left, now = stepAt(left);
			// Fade in over the first quarter second so the start is not a flash of its own.
			const fadeIn = k.clamp(power.elapsed / 0.25);
			if (k.reduceMotion) {
				// Steady level per step, creeping up a little with the power used so it never sits still.
				light(k, now.depth, now.color, fadeIn * (now.rm + 0.05 * (1 - power.frac)));
				return;
			}
			// The latest beat (the smallest beat time not below `left`) and its echo.
			let b = Infinity;
			for (const t of beatsOf(power.total)) if (t >= left - EPS && t < b) b = t;
			let pulse = 0, step = now;
			if (b !== Infinity) {
				step = stepAt(b);
				// In the fast stage the echo is heard but not shown: a big red area must not pulse
				// more than about three times a second (photosensitivity), so one pulse per beat.
				const race = step === STEPS[0], fade = race ? 0.08 : 0.11, since = b - left;
				pulse = Math.max(shape(since, fade), race ? 0 : 0.45 * shape(since - step.dub, fade));
			}
			light(k, now.depth, now.color, fadeIn * (now.base + (step.peak - now.base) * pulse));
		} else if (justExpired(k, FINAL)) {
			// The final beat: one big red pulse that reaches deeper in, then nothing.
			const t = power.sinceExpired;
			const s = k.reduceMotion ? 0.9 * (1 - t / FINAL) ** 2 : shape(t, 0.18);
			light(k, 4.2, HOT, s);
		}
	},

	sound(prev, f, sfx) {
		if (expiredNow(f.events)) {
			sfx.tone(110, 0.5, { type: 'sine', vol: 0.06, to: 38 });
			sfx.tone(220, 0.2, { type: 'triangle', vol: 0.03, to: 70 });
			sfx.noise(0.14, { vol: 0.04, freq: 160, q: 0.8 });
			return;
		}
		const a = prev.power, z = f.power;
		if (z.left <= 0 || a.serial !== z.serial || a.left <= z.left) return;
		for (const b of beatsOf(z.total)) {
			const s = stepAt(b), loud = s === STEPS[0] ? 1 : s === STEPS[1] ? 0.75 : 0.55;
			// Lub on the beat, dub a moment later; each fires when its time is crossed this frame.
			if (a.left > b && z.left <= b) {
				sfx.tone(95, 0.16, { type: 'sine', vol: 0.06 * loud, to: 48 });
				sfx.tone(190, 0.06, { type: 'triangle', vol: 0.02 * loud, to: 90 });
			}
			const d = b - s.dub;
			if (d > 0 && a.left > d && z.left <= d) sfx.tone(80, 0.12, { type: 'sine', vol: 0.04 * loud, to: 45 });
		}
	}
};
