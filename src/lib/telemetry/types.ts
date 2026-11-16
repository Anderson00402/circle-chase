/**
 * Data shapes produced by telemetry. `docs/STUDY.md` defines every measure; the tracker
 * (`tracker.ts`) implements them and `convex/schema.ts` stores them.
 */
import type { GhostId, PowerEndReason } from '../game/types';

/**
 * Outcome of one power-up, first that applies (STUDY.md "Outcome of a trial"), plus two classes
 * the study text does not name:
 * - `other`: engaged, but none of the five behaviour classes fits (for example the player ate the
 *   last scared ghost with 2.5 s left, so nothing was left to chase or to flee from).
 * - `interrupted`: the power-up did not run out by itself (death, level clear, a second power dot,
 *   or the player left). There is no end to judge, so it never counts toward the rates.
 */
export type Outcome =
	| 'caught'
	| 'late-catch'
	| 'overstayed'
	| 'timely-retreat'
	| 'early-retreat'
	| 'not-engaged'
	| 'other'
	| 'interrupted';

export const OUTCOMES: readonly Outcome[] = [
	'caught', 'late-catch', 'overstayed', 'timely-retreat', 'early-retreat', 'not-engaged', 'other', 'interrupted'
];

/** Plain words for each outcome, for panels and dashboards. */
export const OUTCOME_LABEL: Record<Outcome, string> = {
	caught: 'Caught',
	'late-catch': 'Late catch',
	overstayed: 'Overstayed',
	'timely-retreat': 'Timely retreat',
	'early-retreat': 'Early retreat',
	'not-engaged': 'Not engaged',
	other: 'Other',
	interrupted: 'Interrupted'
};

/** `quit`: the block ended (page closed, game restarted) while the power-up was still on. */
export type TrialEndReason = PowerEndReason | 'quit';

export interface EatRecord {
	/** Seconds since the power-up started (game time). */
	t: number;
	/** Power left when the ghost was eaten. */
	left: number;
	ghost: GhostId;
	points: number;
}

/** 10 Hz samples from the power start to 3 s after its end. Parallel arrays. */
export interface TrialSeries {
	/** Seconds since the power-up started. */
	t: number[];
	/** Power left; negative after the end (seconds since it ran out). */
	left: number[];
	/** Path distance to the nearest target ghost in tiles, or null when there is none. */
	dist: (number | null)[];
	/** 1 while the player is chasing (see STUDY.md), else 0. */
	chasing: number[];
	/** Player tile. */
	px: number[];
	py: number[];
}

export interface Aftermath {
	/** Seconds of the 3 s aftermath actually observed (less when a new power-up or a level clear cut it short). */
	seen: number;
	/** Died during the aftermath, to any ghost. */
	died: boolean;
	/** Died during the aftermath to a ghost that had been scared when the power ran out. */
	caught: boolean;
	timeToCaught: number | null;
	killer: GhostId | null;
	/** Smallest path distance to any dangerous ghost during the aftermath. */
	minDangerDist: number | null;
	/** Came within 1.5 tiles of a dangerous ghost and survived. */
	nearMiss: boolean;
	/**
	 * Why the aftermath ended before 3 s, if it did: a new power-up, a level clear, or the player
	 * left (block ended). A death is not a cut, it is the measure. `quit` keeps the trial out of the rates.
	 */
	cut: 'power' | 'clear' | 'quit' | null;
}

/** One power-up, measured. Context about who played and how is added by the client. */
export interface TrialMeasures {
	/** `Frame.power.serial` of this power-up within its game. */
	serial: number;
	/** Game time the power-up started and ended. */
	startedAt: number;
	endedAt: number;
	/** Power length in seconds. */
	total: number;
	level: number;
	mazeId: string;
	endReason: TrialEndReason;
	/** Power left at the moment it ended: 0 when it ran out, more when something cut it short. */
	leftAtEnd: number;
	/** Ghosts the power-up made edible (ghosts in the pen are not scared). */
	scaredAtStart: number;

	outcome: Outcome;
	/** Chasing at some point in the warning window (the last 3 s of the power). */
	engaged: boolean;
	/** Counts toward caught and well-timed rates: engaged, the power ran out by itself, and the player did not leave during the aftermath. */
	inRates: boolean;

	eats: EatRecord[];
	/** A ghost eaten with 1.5 s or less left. */
	lateCatch: boolean;
	/** Power left when the last scared ghost was eaten; null if some were still scared at the end. */
	allEatenLeft: number | null;

	/** Power left when the player stopped closing in for good; negative after the end; null if they never did. */
	turnLeft: number | null;
	turnDist: number | null;
	/** Seconds since the power started (game time) of the turn-away moment. */
	turnAt: number | null;
	/** At the turn, a scared ghost was out and could still be reached before the power ran out. */
	turnReachable: boolean | null;
	/** Number of separate chases during the power-up. */
	chases: number;

	/** Path distance to the nearest ghost that just turned dangerous, when the power ran out. */
	endDist: number | null;
	/** Was the player still closing in when the power ran out. */
	endClosing: boolean | null;

	after: Aftermath;
	/** For players still closing in at the end: seconds from the end until they first moved away. */
	reaction: number | null;
	/** Power left unused after an early retreat (= turnLeft for early retreats). */
	wasted: number | null;
	/** Died while the power was still on (to a ghost that was not scared). */
	diedDuring: boolean;

	/** Frames seen and average frame rate over the trial. */
	frames: number;
	fps: number;
	series: TrialSeries;
}

/** What the on-screen panel shows while playing. */
export interface LiveReadout {
	state: 'idle' | 'power' | 'after';
	/** Power left, negative in the aftermath. */
	left: number;
	total: number;
	nearest: { ghost: GhostId; dist: number } | null;
	chasing: boolean;
	engaged: boolean;
	/** Best guess of the outcome so far; null before anything can be said. */
	guess: Outcome | null;
}
