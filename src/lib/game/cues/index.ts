import type { Cue, CueId } from '../types';
import { classicBlink, none } from './references';
import { timerBar } from './timer-bar';
import { inkRefill } from './ink-refill';
import { clockHalos } from './clock-halos';
import { wakingGhosts } from './waking-ghosts';
import { heartbeat } from './heartbeat';
import { deflatingPlayer } from './deflating-player';
import { finalCount } from './final-count';
import { burningFuse } from './burning-fuse';
import { wallTide } from './wall-tide';
import { penHourglass } from './pen-hourglass';
import { dotSweep } from './dot-sweep';

/**
 * Every condition, in display order: the two references (A, B), the timer bar (0), then ideas 1-10.
 * To add one: write `cues/<id>.ts` exporting a `Cue`, then list it here.
 */
export const CUES: Cue[] = [none, classicBlink, timerBar, inkRefill, clockHalos, burningFuse, wallTide, heartbeat, wakingGhosts, penHourglass, deflatingPlayer, finalCount, dotSweep];

export const CUE_IDS: CueId[] = [
	'none', 'classic-blink', 'timer-bar', 'ink-refill', 'clock-halos', 'burning-fuse', 'wall-tide', 'heartbeat',
	'waking-ghosts', 'pen-hourglass', 'deflating-player', 'final-count', 'dot-sweep'
];

export function cueById(id: string | null | undefined): Cue {
	return CUES.find((c) => c.id === id) ?? timerBar;
}
