import type { Cue, CueContext } from '../types';
import { CALM, expiredNow, HOT, justExpired, powered, WARN } from './shared-screen';

/**
 * Deflating player: the hero carries the power.
 *
 * On a power dot the hero swells a little and glows, ringed by a dial of ten sparks at fixed
 * places around it. The dial is the message: it empties like the other clock cues, a dark gap
 * opening at 12 o'clock and growing clockwise, so the lit part left is the time left (half the
 * ring dark is half the time gone, whatever the power length). The spark about to go dims through
 * its share of time and then peels away. Nothing else changes until the last 2 s: then the
 * warning takes over the whole hero, large and where the eye already is: the whole dial track
 * turns red (the part still lit stays bright, so the dial keeps telling the time), the warm halo
 * behind the hero turns into a red one and a red rim closes round the hero, and the hero deflates
 * back to its normal size, reaching it as the power ends with a small puff of smoke. All steady:
 * no blinking, so reduced motion only drops the peel drift, twinkle and smoke.
 *
 * Only the drawing changes: the hero's hit box is the same as always.
 */

const N = 10; // sparks on the dial
const SWELL = 0.22; // extra size while powered (1.22x: still inside its corridor)
const INFLATE = 0.3, PEEL = 0.5, PUFF = 0.5; // seconds
const GLOW = '#fff6c0';

/** How swollen the hero is: fully until the last 2 s, then back down to normal at the end. */
function swell(k: CueContext) {
	return k.clamp(k.power.left / WARN);
}

/** Seconds left when spark `i` goes out: the dial empties clockwise from 12 o'clock, spark 0 first. */
const outAt = (total: number, i: number) => total * (1 - (i + 1) / N);

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
	tagline: 'A ring of sparks around you goes out like a clock; you shrink back in the last 2 seconds.',
	description:
		'A power dot makes you swell a little and glow, with a ring of ten sparks around you. The sparks go out one after another clockwise from 12 o\'clock, like a clock running down, so half a dark ring means half the time is gone. In the last 2 seconds the whole ring and your glow turn red, with a red rim around you, and you shrink back to normal size; when the power ends you let out a small puff.',
	channel: 'player',
	baseFlash: false,

	player(k, cx, cy, drawDefault) {
		const { T, power } = k;
		if (powered(k)) {
			const g = swell(k), warn = power.left <= WARN;
			// The final warning switches on over a tenth of a second (no one-frame pop) and deepens a
			// little towards the end.
			const alarm = k.smoothstep(WARN, WARN - 0.1, power.left), deep = k.clamp(1 - power.left / WARN);
			const inflate = k.reduceMotion ? 1 : k.ease.outBack(k.clamp(power.elapsed / INFLATE));
			const scale = 1 + SWELL * g * inflate;
			// Halo behind the hero: warm and steady, red in the last 2 s.
			k.glow(cx, cy, T * 1.3, GLOW, 0.4 * g * k.clamp(inflate) * (1 - alarm));
			if (alarm > 0) k.glow(cx, cy, T * (1.55 + 0.25 * deep), HOT, (0.8 + 0.2 * deep) * alarm);
			k.drawPlayer(cx, cy, scale, { color: k.mix(k.colors.player, GLOW, 0.45 * g * (1 - alarm)) });
			// A red rim round the hero, just outside its body, over a dark keyline.
			if (alarm > 0) {
				const rr = T * 0.5 * scale + Math.max(1.5, T * 0.09);
				k.ring(cx, cy, rr, Math.max(3, T * 0.17), k.colors.bg, { alpha: 0.5 * alarm });
				k.ring(cx, cy, rr, Math.max(1.6, T * 0.1), HOT, { alpha: alarm });
			}

			// The dial: the lit arc runs from the hand clockwise round to 12 o'clock, like a clock
			// face whose gap opens at 12 and grows clockwise. In the last 2 s the whole track turns
			// red; the lit part stays brighter and thicker, so the time left still reads.
			const used = 1 - power.frac, hand = used * Math.PI * 2, gone = used * N, R0 = T * 0.84;
			const color = warn ? HOT : CALM;
			k.ring(cx, cy, R0, Math.max(2.5, T * (0.18 + 0.08 * alarm)), k.colors.bg, { alpha: 0.55 + 0.2 * alarm }); // dark track, so it reads on any wall
			k.ring(cx, cy, R0, Math.max(0.8, T * (0.05 + 0.06 * alarm)), alarm > 0 ? k.mix(k.rgba(CALM, 0.3), k.rgba(HOT, 0.42), alarm) : k.rgba(CALM, 0.3));
			if (alarm > 0) {
				k.ctx.save();
				k.ctx.shadowColor = HOT;
				k.ctx.shadowBlur = T * 0.4 * alarm * k.dpr;
				k.ring(cx, cy, R0, Math.max(2.4, T * 0.16), k.mix(HOT, '#ffffff', 0.55), { from: hand, to: Math.PI * 2, alpha: 1 });
				k.ctx.restore();
			} else k.ring(cx, cy, R0, Math.max(1.6, T * 0.09), color, { from: hand, to: Math.PI * 2, alpha: 0.9 });
			for (let i = 0; i < N; i++) {
				if (i + 1 <= gone) continue;
				const x = cx + Math.cos(angleOf(i)) * R0, y = cy + Math.sin(angleOf(i)) * R0;
				// The next spark to go dims through its own share of the time.
				const u = Math.min(1, i + 1 - gone);
				const twinkle = k.reduceMotion ? 1 : 0.92 + 0.08 * Math.sin(k.now * 7 + i * 1.7);
				star(k, x, y, Math.max(1.6, T * 0.2) * (0.6 + 0.4 * u) * twinkle, color, 0.4 + 0.6 * u);
			}
			// Sparks that just went out drift away.
			for (let i = 0; i < N; i++) {
				const at = outAt(power.total, i);
				peeled(k, cx, cy, i, at - power.left, at <= WARN ? HOT : CALM);
			}
			return;
		}
		if (justExpired(k, PUFF)) {
			// The puff: a small dip in size, a ring of smoke and the last spark leaving.
			const t = power.sinceExpired, u = t / PUFF;
			const scale = k.reduceMotion ? 1 : 1 - 0.08 * Math.sin(Math.PI * u);
			k.drawPlayer(cx, cy, scale);
			peeled(k, cx, cy, N - 1, t, HOT);
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
