import type { Cue, CueId } from '../types';
import { timerBar } from './timer-bar';

/**
 * Every countdown cue, in display order (index 0 is the baseline).
 * To add one: write `cues/<id>.ts` exporting a `Cue`, then list it here.
 */
export const CUES: Cue[] = [timerBar];

export const CUE_IDS: CueId[] = [
	'timer-bar', 'ink-refill', 'clock-halos', 'burning-fuse', 'wall-tide', 'heartbeat',
	'waking-ghosts', 'pen-hourglass', 'deflating-player', 'final-count', 'dot-sweep'
];

export function cueById(id: string | null | undefined): Cue {
	return CUES.find((c) => c.id === id) ?? CUES[0];
}
