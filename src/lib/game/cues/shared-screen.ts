import type { CueContext } from '../types';

/**
 * Small helpers shared by the screen-wide and on-player cues (heartbeat, deflating player,
 * final count). All pure: they only read their arguments.
 */

/**
 * The same three-stage colour story in all three cues, so "cool" always means plenty of time and
 * "red" always means the end: calm (pale ice), getting low (amber), last 2 seconds (heart red).
 */
export const CALM = '#cfe6ff';
export const LOW = '#ffc04d';
export const HOT = '#ff4d6d';

/** Seconds left at which the final warning starts, the same for every power length. */
export const WARN = 2;

/** True while a power-up is running and the game is in normal play (not dying, not cleared). */
export function powered(k: CueContext): boolean {
	return k.power.active && k.frame.phase === 'playing';
}

/** True for a short moment after the power ran out by itself, while play goes on. */
export function justExpired(k: CueContext, within: number): boolean {
	return k.frame.phase === 'playing' && !k.power.active && k.power.sinceExpired < within;
}

/** The end of a power-up that ran out by itself, seen in this frame's events. */
export function expiredNow(events: { type: string; reason?: string }[]): boolean {
	return events.some((e) => e.type === 'powerEnd' && e.reason === 'expired');
}
