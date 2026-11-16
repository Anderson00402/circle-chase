import type { Cue, CueContext } from '../types';
import { CALM, expiredNow, HOT, justExpired, LOW, powered } from './shared-screen';

/**
 * Final count: nothing for most of the power-up, then 3-2-1 stamped next to the hero.
 *
 * The calm is the point: the player learns that no numeral means "plenty left". Each numeral lands
 * exactly as the time left crosses a whole second and stays until the next one replaces it. The
 * count starts at 3 when there is time for a calm stretch before it, and is shorter on short
 * power-ups (2-1 under 3.5 s, just 1 under 2.5 s), so it never fills most of the power.
 *
 * Where: the numerals ride just above the hero (below it near the top wall). The eye is already
 * there during a chase, so nothing needs looking away, unlike a numeral in the middle of the
 * board. They are drawn under the characters, so a wisp passing behind a numeral stays in full
 * view. When the power ends a ring bursts out from the hero: the "zero".
 *
 * Reduced motion: no slam and no growing ring; numerals appear and fade, and the end ring holds
 * still while it fades.
 */

const STAMP = 0.14; // seconds of the slam-in
const END = 0.6; // seconds of the end ring
const COLORS: Record<number, string> = { 3: CALM, 2: LOW, 1: HOT };

/** First numeral of the count for a power of this length. */
export const countFrom = (total: number) => Math.max(1, Math.min(3, Math.floor(total - 0.5)));

/** The numeral showing now and how long ago it landed, or null outside the count. */
function current(k: CueContext): { n: number; age: number } | null {
	const { left, total } = k.power;
	if (left <= 0) return null;
	const n = Math.ceil(left - 1e-9);
	return n > countFrom(total) ? null : { n, age: n - left };
}

/**
 * Where the numeral sits for a hero at (cx, cy): one tile up and to the right, a spot that is
 * mostly wall in a maze (the corridor ahead stays clear), flipped near the top or right edge.
 */
function spot(k: CueContext, cx: number, cy: number): [number, number] {
	const T = k.T, d = T * 1.15, { w } = k.geo.board;
	const x = cx + d > w - T * 1.2 ? cx - d : cx + d;
	const y = cy - d < T * 1.3 ? cy + d : cy - d;
	return [x, y];
}

export const finalCount: Cue = {
	id: 'final-count',
	role: 'idea',
	code: '9',
	name: 'Final count',
	tagline: 'Nothing at first, then 3-2-1 next to you as the power runs out.',
	description:
		'For most of the power-up nothing changes. In the last seconds a big 3, 2 and 1 land next to you, one per second, with a tick; a ring bursts out from you as the power ends. On short power-ups the count starts at 2 or 1.',
	channel: 'player',
	baseFlash: false,

	under(k) {
		const { T } = k;
		const c = powered(k) ? current(k) : null;
		if (c) {
			const color = COLORS[c.n] ?? HOT;
			let scale = 1, alpha = 1;
			if (k.reduceMotion) alpha = k.clamp(c.age / 0.12) * (1 - 0.35 * k.smoothstep(0.6, 1, c.age));
			else {
				// Slams in oversized, settles, then dims a little before the next one replaces it.
				const u = k.clamp(c.age / STAMP);
				scale = c.age < STAMP ? 1.7 - 0.7 * k.ease.outBack(u) : 1;
				alpha = k.clamp(c.age / 0.04) * (1 - 0.35 * k.smoothstep(0.6, 1, c.age));
			}
			const size = Math.max(10, T * 1.9);
			k.eachWrap(k.frame.player.x, (px) => {
				const [x, y] = spot(k, px, k.playerPos()[1]);
				k.text(String(c.n), x, y, {
					size, font: 'display', weight: 800, fill: color, stroke: k.colors.bg,
					strokeWidth: Math.max(2, T * 0.2), glow: color, scale, alpha
				});
			});
			return;
		}
		if (justExpired(k, END)) {
			// The zero: a ring bursts out from the hero and thins away.
			const u = k.power.sinceExpired / END;
			k.eachWrap(k.frame.player.x, (px) => {
				const py = k.playerPos()[1];
				if (k.reduceMotion) {
					k.ring(px, py, T * 1.4, Math.max(1.5, T * 0.16), HOT, { alpha: 0.9 * (1 - u) });
					return;
				}
				const e = k.ease.outCubic(u);
				k.ring(px, py, T * (0.6 + 4.5 * e), Math.max(1, T * 0.3 * (1 - u)), HOT, { alpha: 1 - u });
				k.ring(px, py, T * (0.5 + 2.6 * e), Math.max(1, T * 0.14 * (1 - u)), '#ffffff', { alpha: 0.8 * (1 - u) });
			});
		}
	},

	sound(prev, f, sfx) {
		if (expiredNow(f.events)) {
			sfx.tone(330, 0.26, { type: 'triangle', vol: 0.05, to: 110 });
			sfx.noise(0.18, { vol: 0.05, freq: 180, q: 0.7 });
			return;
		}
		const a = prev.power, z = f.power;
		if (z.left <= 0 || a.serial !== z.serial || a.left <= z.left) return;
		// A tick as each numeral lands, rising 3 -> 2 -> 1.
		for (let n = countFrom(z.total); n >= 1; n--) {
			if (a.left > n && z.left <= n) {
				const f0 = sfx.note(n === 3 ? 'E5' : n === 2 ? 'A5' : 'E6');
				sfx.tone(f0, 0.07, { type: 'square', vol: 0.035 });
				sfx.tone(f0 * 2, 0.03, { type: 'sine', vol: 0.02 });
			}
		}
	}
};
