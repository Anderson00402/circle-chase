import type { Cue, CueContext } from '../types';
import { CALM, expiredNow, HOT, justExpired, powered, WARN } from './shared-screen';

/**
 * Deflating player: the hero carries the power.
 *
 * On a power dot the hero swells and glows, ringed by a dial of ten sparks at fixed places around
 * it. The sparks go out in order like a clock running backwards (the dark part grows clockwise
 * from 12 o'clock), so the fraction left reads at a glance whatever the power length: half the
 * ring dark is half the time gone. The spark about to go dims through its share of time and then
 * peels away. The hero shrinks back as the power drains, slowly at first and most of the way in
 * the last 2 s, when the remaining sparks also turn red and blink in five beats. At the end the
 * hero gives a small puff of smoke and is its normal self again.
 *
 * Only the drawing changes: the hero's hit box is the same as always.
 */

const N = 10; // sparks on the dial
const SWELL = 0.28; // extra size at full power (1.28x: still inside its corridor)
const INFLATE = 0.3, PEEL = 0.5, PUFF = 0.5; // seconds
const GLOW = '#fff6c0';

/** How swollen the hero is, 1 at full power to 0 at the end: a little drain early, most of it in the last 2 s. */
function swell(k: CueContext) {
	const { frac, left } = k.power;
	return 0.3 * frac + 0.7 * k.smoothstep(0, WARN, left);
}

/** Centre angle of spark `i` (0 = 12 o'clock, clockwise), in canvas radians. */
const angleOf = (i: number) => ((i + 0.5) / N) * Math.PI * 2 - Math.PI / 2;

/** A four-point star with a white heart. */
function star(k: CueContext, x: number, y: number, R: number, color: string, alpha: number) {
	const { ctx } = k;
	if (R < 0.3 || alpha <= 0.01) return;
	ctx.globalAlpha = alpha;
	ctx.fillStyle = color;
	ctx.beginPath();
	for (let s = 0; s < 8; s++) {
		const a = (s * Math.PI) / 4 - Math.PI / 2, d = s % 2 ? R * 0.34 : R;
		ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
	}
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = '#ffffff';
	ctx.beginPath();
	ctx.arc(x, y, R * 0.28, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalAlpha = 1;
}

/** A spark that went out `age` seconds ago, leaving its place on the dial and fading. */
function peeled(k: CueContext, cx: number, cy: number, i: number, age: number, color: string) {
	if (age < 0 || age > PEEL) return;
	const u = age / PEEL, T = k.T, R0 = T * 0.86;
	if (k.reduceMotion) {
		star(k, cx + Math.cos(angleOf(i)) * R0, cy + Math.sin(angleOf(i)) * R0, T * 0.13, color, 0.8 * (1 - u));
		return;
	}
	const e = k.ease.outCubic(u), a = angleOf(i) + 0.6 * e, r = R0 + T * 0.9 * e;
	star(k, cx + Math.cos(a) * r, cy + Math.sin(a) * r - T * 0.3 * e, T * 0.13 * (1 - 0.5 * e), color, 0.9 * (1 - u));
}

export const deflatingPlayer: Cue = {
	id: 'deflating-player',
	role: 'idea',
	code: '8',
	name: 'Deflating player',
	tagline: 'You swell up with power and shrink back as it runs out.',
	description:
		'A power dot makes you swell and glow, with a ring of ten sparks around you. The sparks go out one after another like a clock running down, so half a dark ring means half the time is gone; in the last 2 seconds the last sparks turn red and blink while you shrink back. When the power ends you let out a small puff and are back to normal.',
	channel: 'player',
	baseFlash: false,

	player(k, cx, cy, drawDefault) {
		const { T, power } = k;
		if (powered(k)) {
			const g = swell(k), warn = power.left <= WARN;
			const inflate = k.reduceMotion ? 1 : k.ease.outBack(k.clamp(power.elapsed / INFLATE));
			const scale = 1 + SWELL * g * inflate;
			// Warm halo behind the hero, fading with the swell.
			k.glow(cx, cy, T * (0.9 + 0.5 * g), GLOW, 0.45 * g * k.clamp(inflate));
			k.drawPlayer(cx, cy, scale, { color: k.mix(k.colors.player, GLOW, 0.55 * g) });

			// The dial. Spark i is lit while more than i tenths of the power are left; the lit arc
			// runs clockwise from 12 o'clock to the fraction left.
			const lit = power.frac * N, R0 = T * 0.84;
			const dim = warn && !k.reduceMotion && !k.baseFlash() ? 0.4 : 1;
			const color = warn ? HOT : CALM;
			k.ring(cx, cy, R0, Math.max(2, T * 0.16), k.colors.bg, { alpha: 0.5 }); // dark track, so it reads on any wall
			k.ring(cx, cy, R0, Math.max(0.8, T * 0.05), k.rgba(CALM, 0.3));
			k.ring(cx, cy, R0, Math.max(1.2, T * 0.08), color, { from: 0, to: Math.PI * 2 * power.frac, alpha: 0.85 * dim });
			for (let i = 0; i < N; i++) {
				if (i >= lit) continue;
				const x = cx + Math.cos(angleOf(i)) * R0, y = cy + Math.sin(angleOf(i)) * R0;
				// The next spark to go dims through its own share of the time.
				const u = Math.min(1, lit - i);
				const twinkle = k.reduceMotion ? 1 : 0.9 + 0.1 * Math.sin(k.now * 7 + i * 1.7);
				star(k, x, y, T * 0.2 * (0.6 + 0.4 * u) * twinkle * (warn ? 1.1 : 1), color, (0.4 + 0.6 * u) * dim);
			}
			// Sparks that just went out drift away.
			for (let i = 0; i < N; i++) peeled(k, cx, cy, i, power.total * (i / N) - power.left, (i / N) * power.total <= WARN ? HOT : CALM);
			return;
		}
		if (justExpired(k, PUFF)) {
			// The puff: a small dip in size, a ring of smoke and the last spark leaving.
			const t = power.sinceExpired, u = t / PUFF;
			const scale = k.reduceMotion ? 1 : 1 - 0.08 * Math.sin(Math.PI * u);
			k.drawPlayer(cx, cy, scale);
			peeled(k, cx, cy, 0, t, HOT);
			const smoke = k.mix(CALM, '#ffffff', 0.4);
			if (k.reduceMotion) {
				k.ring(cx, cy, T * 0.85, Math.max(1, T * 0.1), smoke, { alpha: 0.7 * (1 - u) });
				return;
			}
			const e = k.ease.outCubic(u);
			for (let s = 0; s < 8; s++) {
				const a = (s / 8) * Math.PI * 2 + k.hash(s, power.serial) * 0.5;
				const d = T * (0.55 + 0.8 * e), r = T * (0.12 + 0.14 * e);
				k.ctx.globalAlpha = 0.55 * (1 - u);
				k.ctx.fillStyle = smoke;
				k.ctx.beginPath();
				k.ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d - T * 0.2 * e, r, 0, Math.PI * 2);
				k.ctx.fill();
			}
			k.ctx.globalAlpha = 1;
			return;
		}
		drawDefault();
	},

	sound(prev, f, sfx) {
		if (expiredNow(f.events)) {
			sfx.tone(560, 0.3, { type: 'triangle', vol: 0.05, to: 140 });
			sfx.noise(0.25, { vol: 0.03, freq: 900, q: 0.6 });
			return;
		}
		const a = prev.power, z = f.power;
		if (z.left <= 0 || a.serial !== z.serial || a.left <= z.left) return;
		// A tiny high tick as each spark goes out (the last one is the puff above).
		for (let i = 1; i < N; i++) {
			const at = (z.total * i) / N;
			if (a.left > at && z.left <= at) sfx.tone(at <= WARN ? 1568 : 1760, 0.05, { type: 'sine', vol: at <= WARN ? 0.03 : 0.018 });
		}
	}
};
