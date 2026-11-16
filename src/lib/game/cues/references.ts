import type { Cue } from '../types';

/** Control: scared ghosts look scared and nothing says when it will end. The floor every cue should beat. */
export const none: Cue = {
	id: 'none',
	role: 'reference',
	code: 'A',
	name: 'No signal',
	tagline: 'Nothing shows how much power is left.',
	description:
		'Scared ghosts simply stay scared until the power ends, with no warning. This is the control: it shows how players do when they have to guess.',
	channel: 'ghosts',
	baseFlash: false
};

/** The genre's usual signal: scared ghosts blink white in the last 2 seconds. */
export const classicBlink: Cue = {
	id: 'classic-blink',
	role: 'reference',
	code: 'B',
	name: 'Classic blink',
	tagline: 'Scared ghosts blink white in the last 2 seconds.',
	description:
		'Nothing changes for most of the power-up. In the last 2 seconds the scared ghosts blink white five times, and the last blink ends as the power runs out. This is what maze-chase games usually do.',
	channel: 'ghosts',
	baseFlash: true
};
