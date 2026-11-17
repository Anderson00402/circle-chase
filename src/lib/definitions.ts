/**
 * Plain-words definitions of the measures shown next to outcomes (replay player, run summary, and
 * the dashboard can import them too), written from the rules in force (convex/lib/rules.ts, rules
 * version 3; docs/STUDY.md "Chasing" and "Other measures"). The outcome classes themselves are in
 * src/lib/outcomes.ts. Numbers come from the rules file, so a threshold change shows up here.
 */
import { CAUGHT_DIST, CHASE, LATE, OVERSTAY_DIST, REACH_SPEED, TIMELY, WARN } from '#convex/lib/rules.ts';

export const DEFINITIONS = {
	chasing:
		`Going after a scared ghost by the player's own steps: an approach to a ghost at most ${CHASE.range} tiles away becomes a chase once the player's own steps have closed ${CHASE.minGain} tiles on it. ` +
		`It ends when the player backs off ${CHASE.backoff} tile from their closest point, gets no closer for ${CHASE.idle} s, eats the ghost, or the ghost gets out of range.`,
	engaged: `A chase reached into the warning window, the last ${WARN} s of the power: its turn-away or eat came with ${WARN} s or less left, or it was still running at the end.`,
	turnAway:
		'Time left when the player was closest to the ghost of the last chase, before they stopped closing in for good (for a chase that ended by eating the ghost: when it was eaten). Negative: after the end.',
	turnDist: 'Path distance to the chased ghost at the turn-away.',
	distance: 'Path distance through the maze to the nearest scared ghost (after the end: to the ghosts that were scared and now hunt the player).',
	endDist: `Path distance, when the power ran out, to the nearest ghost that had just turned dangerous. Within ${CAUGHT_DIST} tiles a death in the next ${WARN} s counts as caught.`,
	reachable: `The chased ghost could still have been reached before the power ran out: its distance was at most the time left times ${REACH_SPEED} tiles a second.`,
	window: `Turned away in time means ${TIMELY[0]} to ${TIMELY[1]} s of power left; a chase still running with less than ${TIMELY[0]} s left, with the ghost within ${OVERSTAY_DIST} tiles, is staying too long.`,
	lateCatch: `A catch with ${LATE} s or less of power left.`,
	reaction: 'For a chase still running when the power ran out: seconds after the end the player kept stepping toward the ghost.',
	nearMiss: 'Within 1.5 tiles of a dangerous ghost in the 3 s after the end, and not caught.',
	counted:
		'A power-up counts toward the rates when the power ran out by itself, the player stayed for the 3 s after, the last chase reached into the last 3 s (or a reachable ghost was given up before them), it was classed by the current rules, and it ended in a decision: turned away in time, too early, stayed too long, or caught.'
} as const;
export type DefinitionKey = keyof typeof DEFINITIONS;
