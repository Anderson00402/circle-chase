/**
 * The outcome rules of a trial (docs/STUDY.md "Outcome of a trial"), in one pure place used by
 * both sides: the tracker classifies a trial when it ends, and Convex recomputes the class from the
 * stored raw measures (`admin.reclassify`). The stored measures are the source of truth; the class
 * is derived from them and can always be recomputed.
 *
 * Every number that decides a class lives here, including the ones the tracker uses to tell what a
 * chase is (`CHASE`), so docs/STUDY.md has one file to point at.
 *
 * No imports, so the browser (src/lib/telemetry/tracker.ts) and Convex can both bundle it.
 */

/**
 * Bumped whenever the rules below, or the way the tracker measures a chase, change. Trials store
 * the version they were measured and classified with.
 * 1: first rules. 2: the final decision comes from the last chase. 3: a chase is the player's own
 * sustained movement toward a ghost in range; retreats need a reachable ghost, staying too long a
 * near one; giving up before the warning window counts as too early.
 */
export const RULES_VERSION = 3;

/** Seconds: the warning window (the last 3 s of the power) and the aftermath. */
export const WARN = 3;
/** Seconds: a catch with this much or less left is a late catch. */
export const LATE = 1.5;
/** Seconds left: turning away in this window is "turned away in time". */
export const TIMELY: readonly [number, number] = [0.2, 2];
/**
 * Seconds left: the alternative "too early" line the dashboard can switch to as a sensitivity check
 * (docs/STUDY.md "2 s, and the cues' final warning"). It never changes a stored outcome: the page
 * recomputes the classes from the stored raw measures with `classify(m, { timely: TIMELY_CHECK })`.
 */
export const TIMELY_CHECK = 2.5;
/** Tiles (path distance) to a ghost that just turned dangerous, at the end, for a death to count as "caught". */
export const CAUGHT_DIST = 5;
/**
 * Tiles (path distance) to the chased ghost when the power ran out, for a chase still running then
 * to count as "stayed too long". The same 5 tiles as `CAUGHT_DIST`: player and ghost running at
 * each other (5.6 + 5.25 tiles/s) close that gap in under half a second.
 */
export const OVERSTAY_DIST = 5;
/**
 * Tiles per second: the player's speed on level 1. A ghost is "reachable" at a turn-away when its
 * distance is at most (power left x this), that is, when the player could still have got to where
 * it stood before the power ran out.
 */
export const REACH_SPEED = 5.6;
/**
 * Tiles per second: how fast a pursuit closes on a scared ghost that flees (study rules: the player
 * at 6.2 tiles/s with the power on, a fleeing ghost at 4.7). Used by the dashboard's "time to spare"
 * view: time left at the turn-away minus the time the pursuit still needed (distance / this). Under
 * arcade rules scared ghosts do not flee and the pursuit is taken to close at `REACH_SPEED`.
 */
export const PURSUIT_GAIN = 1.5;

/**
 * What a chase is (measured by the tracker, src/lib/telemetry/tracker.ts; reasons in STUDY.md).
 * All distances are path distances in tiles and count only the player's own steps.
 */
export const CHASE = {
	/** A ghost farther than this is not a plausible target: a chase cannot start, and ends, beyond it. */
	range: 6,
	/** The player's own steps must close this much on the ghost before the approach counts as a chase. */
	minGain: 3,
	/** The chase is over once the player's own steps took them this far back from their closest point. */
	backoff: 1,
	/** ...or once they came no closer by their own steps for this many seconds. */
	idle: 0.5
} as const;
export type ChaseParams = { range: number; minGain: number; backoff: number; idle: number };

export type Outcome =
	| 'caught'
	| 'overstayed'
	| 'timely-retreat'
	| 'early-retreat'
	| 'catch'
	| 'not-engaged'
	| 'other'
	| 'interrupted';

/** Classes written by rules version 1 only (kept so old rows stay readable). */
export type LegacyOutcome = 'late-catch';

export const OUTCOMES: readonly Outcome[] = [
	'caught', 'overstayed', 'timely-retreat', 'early-retreat', 'catch', 'not-engaged', 'other', 'interrupted'
];

/**
 * The trials that reveal a decision about the time left: the denominator of every rate.
 * A catch is not among them: eating a ghost shows the player was chasing, not whether they knew
 * how much time was left.
 */
export const DECISIONS: readonly Outcome[] = ['caught', 'overstayed', 'timely-retreat', 'early-retreat'];

/** Thresholds a caller may move for a sensitivity check (defaults: the values above). */
export interface RuleOptions {
	/** Seconds left: the line between "turned away in time" and "too early" (default `TIMELY[1]`). */
	timely?: number;
}

/** How the trial's last chase ended: the player turned away, ate the ghost, or was still chasing when the trial closed. */
export type ChaseEnd = 'turn' | 'eat' | 'open';

/** The raw measures the rules read. Field meanings: src/lib/telemetry/types.ts (`TrialMeasures`). */
export interface RuleInput {
	endReason: string;
	/** A chase was under way in the warning window (or a ghost was eaten in it). */
	engaged: boolean;
	after: { caught: boolean; cut?: 'power' | 'clear' | 'quit' | null };
	/** Path distance at the end to the nearest ghost that just turned dangerous. */
	endDist: number | null;
	/** How the last chase ended; null when there was no chase. Absent on rows recorded before rules version 2. */
	lastChaseEnd?: ChaseEnd | null;
	/** Power left at the turn-away (at the eat, for a chase that ended in one); negative after the end. */
	turnLeft: number | null;
	/** Path distance to the chased ghost at the turn-away. */
	turnDist?: number | null;
	/**
	 * Path distance to the last chase's ghost at the moment the power ran out; null when that ghost
	 * was no longer there (eaten) or the power did not run out. Absent on rows recorded before rules
	 * version 3, which is how those rows are told apart.
	 */
	chaseEndDist?: number | null;
}

/** True when the row was measured the way these rules need (the tracker of rules version 3 or later). */
export function classifiable(m: Partial<RuleInput>): boolean {
	return m.lastChaseEnd !== undefined && m.chaseEndDist !== undefined;
}

/** The last chase was still running when the power ended (turned with less than 0.2 s left, after the end, or never). */
export function stayedOn(m: Pick<RuleInput, 'lastChaseEnd' | 'turnLeft'>): boolean {
	if (m.lastChaseEnd === 'open') return true;
	return m.lastChaseEnd === 'turn' && m.turnLeft !== null && m.turnLeft < TIMELY[0];
}

/** At the turn-away the chased ghost could still have been reached before the power ran out. */
export function reachableAtTurn(m: Pick<RuleInput, 'lastChaseEnd' | 'turnLeft' | 'turnDist'>): boolean {
	if (m.lastChaseEnd !== 'turn' || m.turnLeft === null || m.turnLeft <= 0) return false;
	return m.turnDist !== null && m.turnDist !== undefined && m.turnDist <= m.turnLeft * REACH_SPEED;
}

/**
 * The player gave up a reachable ghost before the warning window: the last chase ended in a
 * turn-away with more than 3 s left and nothing was chased or eaten after it. Counted as "turned
 * away too early" (STUDY.md says why); this flag lets the share be shown apart.
 */
export function gaveUpEarly(m: RuleInput): boolean {
	return m.endReason === 'expired' && !m.engaged && reachableAtTurn(m) && m.turnLeft! > TIMELY[1];
}

/**
 * Outcome of a trial, first that applies:
 * 1. interrupted: the power did not run out by itself.
 * 2. caught: died within 3 s after the end to a ghost that had been scared, and was within 5 tiles
 *    of a ghost that had just turned dangerous when the power ended.
 * 3. No chase at all: not engaged.
 * 4. The final decision, from how the last chase ended:
 *    - eat: catch when it was in the warning window, otherwise not engaged;
 *    - still running at the end (never turned, turned after the end or with less than 0.2 s left):
 *      overstayed when the chased ghost was within 5 tiles at the end, otherwise other;
 *    - turned with 0.2 s or more left while the ghost was reachable: timely retreat up to 2 s left,
 *      early retreat above (also before the warning window: `gaveUpEarly`);
 *    - turned from a ghost that was out of reach: other inside the warning window, not engaged before it.
 * A death after the end that does not meet rule 2 leaves the class as it is.
 */
export function classify(m: RuleInput, o: RuleOptions = {}): Outcome {
	if (m.endReason !== 'expired') return 'interrupted';
	if (m.after.caught && m.endDist !== null && m.endDist <= CAUGHT_DIST) return 'caught';
	const end = m.lastChaseEnd ?? null;
	if (end === null) return 'not-engaged';
	if (end === 'eat') return m.engaged ? 'catch' : 'not-engaged';
	if (stayedOn(m)) {
		const d = m.chaseEndDist ?? null;
		return d !== null && d <= OVERSTAY_DIST ? 'overstayed' : 'other';
	}
	if (!reachableAtTurn(m)) return m.engaged ? 'other' : 'not-engaged';
	return m.turnLeft! <= (o.timely ?? TIMELY[1]) ? 'timely-retreat' : 'early-retreat';
}

/**
 * Eligible for the rates: the power ran out by itself, the player stayed for the aftermath, and the
 * trial has a final chase to judge (one in the warning window, or one given up before it). Fixed by
 * what the player did during the power, never by how the aftermath went, so the denominator does
 * not depend on the outcome. Only the decision outcomes among these count (`isDecision`).
 */
export function eligible(m: RuleInput): boolean {
	return m.endReason === 'expired' && m.after.cut !== 'quit' && (m.engaged || gaveUpEarly(m));
}

/** Everything derived from the raw measures of a trial. */
export interface Derived {
	outcome: Outcome;
	inRates: boolean;
	/** Power left unused after an early retreat. */
	wasted: number | null;
	gaveUpEarly: boolean;
}

export function derive(m: RuleInput, o: RuleOptions = {}): Derived {
	const outcome = classify(m, o);
	return { outcome, inRates: eligible(m), wasted: outcome === 'early-retreat' ? m.turnLeft : null, gaveUpEarly: gaveUpEarly(m) };
}

/** A catch made with 1.5 s or less left (for a catch, `turnLeft` is the power left at the eat). */
export function isLateCatch(m: { outcome: string; turnLeft: number | null }): boolean {
	return m.outcome === 'catch' && m.turnLeft !== null && m.turnLeft <= LATE;
}

/** Counts toward the rates: classified under the current rules, eligible (`inRates`) and a decision. */
export function isDecision(t: { outcome: string; inRates: boolean; rulesVersion?: number }): boolean {
	return t.rulesVersion === RULES_VERSION && t.inRates && (DECISIONS as readonly string[]).includes(t.outcome);
}

/** Eligible trial under the current rules (the denominator of the catch share). */
export function isCountedEngaged(t: { inRates: boolean; rulesVersion?: number }): boolean {
	return t.rulesVersion === RULES_VERSION && t.inRates;
}

/**
 * The derived fields of a stored trial, recomputed from its raw measures: outcome, rules version,
 * eligibility, wasted power and the "gave up early" flag. A row that was not measured the way
 * these rules need (recorded before this version) keeps everything it has, including its old rules
 * version, which keeps it out of every rate.
 */
export function rescore<T extends RuleInput & { outcome: string; wasted: number | null; rulesVersion?: number }>(t: T):
	{ outcome: T['outcome'] | Outcome; rulesVersion: number; wasted: number | null; inRates?: boolean; gaveUpEarly?: boolean } {
	if (!classifiable(t)) {
		const was = t.lastChaseEnd === undefined ? 1 : t.rulesVersion ?? 2;
		return { outcome: t.outcome, rulesVersion: Math.min(was, RULES_VERSION - 1), wasted: t.wasted };
	}
	return { ...derive(t), rulesVersion: RULES_VERSION };
}
