import type { CueContext, GhostView } from '../types';

/**
 * Helpers shared by the cues that carry their signal on the scared wisps themselves
 * (ink refill, clock halos, ghosts waking up).
 */

/** Seconds before the end at which every one of these cues gives its final warning. */
export const WARN = 2;

/** The renderer draws wisps a little larger than a tile; this is their size unit at tile T. */
export const wispUnit = (T: number) => T * 1.13;

/**
 * True when this wisp should carry the signal: any scared wisp, out in the maze or still in the
 * pen (the more carriers on screen, the easier the signal is to find). Eaten wisps (eyes) keep the
 * default drawing.
 */
export function carries(k: CueContext, g: GhostView): boolean {
	return k.power.active && g.mode !== 'returning' && k.ghostLook(g) === 'scared';
}

/**
 * The scared look shivers a little sideways (base game, constant all power-up long). Returns the
 * same offset the renderer uses, so a body traced with `k.ghostPath` lines up with the drawing.
 */
export function scaredShiver(k: CueContext, index: number): number {
	return k.reduceMotion ? 0 : Math.sin(k.now * 47 + index * 3) * wispUnit(k.T) * 0.022;
}

/**
 * Seconds since this wisp turned dangerous again because the power ran out, or Infinity. Only for
 * wisps drawn in their normal look (a new power-up or being eaten cancels it).
 */
export function sinceWoke(k: CueContext, g: GhostView): number {
	if (g.revertedAt < 0 || g.mode === 'returning' || k.ghostLook(g) !== 'normal') return Infinity;
	const age = k.now - g.revertedAt;
	return age >= 0 ? age : Infinity;
}

/**
 * Final-warning switch: 0 above 2 s left, 1 from just under 2 s. Short ramp so it reads as a
 * clear change rather than a slow drift, without a one-frame pop.
 */
export function warnOn(k: CueContext): number {
	return k.power.active ? k.smoothstep(WARN, WARN - 0.12, k.power.left) : 0;
}

/** How far into the final warning: 0 at 2 s left, 1 at the end. */
export function warnDepth(k: CueContext): number {
	return k.power.active ? k.clamp(1 - k.power.left / WARN) : 0;
}

/** Shortest horizontal offset from a to b on a board that wraps through the tunnel, in CSS pixels. */
export function wrapDx(k: CueContext, a: number, b: number): number {
	const W = k.maze.W * k.T;
	let d = b - a;
	if (d > W / 2) d -= W;
	else if (d < -W / 2) d += W;
	return d;
}
