/**
 * The outcome rules of a trial (docs/STUDY.md "Outcome of a trial"), in one pure place used by
 * both sides: the tracker classifies a trial when it ends, and Convex recomputes the class from the
 * stored raw measures (`admin.reclassify`). The stored measures are the source of truth; the class
 * is derived from them and can always be recomputed.
 *
 * No imports, so the browser (src/lib/telemetry/tracker.ts) and Convex can both bundle it.
 */

/** Bumped whenever the rules below change. Trials store the version they were classified with. */
export const RULES_VERSION = 2;

/** Seconds: the warning window (the last 3 s of the power) and the aftermath. */
export const WARN = 3;
/** Seconds: a catch with this much or less left is a late catch. */
export const LATE = 1.5;
/** Seconds left: turning away in this window is "turned away in time". */
export const TIMELY: readonly [number, number] = [0.2, 2];
/** Tiles (path distance) to a ghost that just turned dangerous, at the end, for a death to count as "caught". */
export const CAUGHT_DIST = 5;

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

/** How the trial's last chase ended: the player turned away, ate the ghost, or was still chasing when the trial closed. */
export type ChaseEnd = 'turn' | 'eat' | 'open';

/** The raw measures the rules read. Field meanings: src/lib/telemetry/types.ts (`TrialMeasures`). */
export interface RuleInput {
	endReason: string;
	engaged: boolean;
	after: { caught: boolean };
	/** Path distance at the end to the nearest ghost that just turned dangerous. */
	endDist: number | null;
	/** How the last chase ended; null when there was no chase. Absent on rows recorded before rules version 2. */
	lastChaseEnd?: ChaseEnd | null;
	/** Power left at the turn-away (at the eat, for a chase that ended in one); negative after the end. */
	turnLeft: number | null;
	turnReachable: boolean | null;
}

/** True when the row carries every measure these rules need. */
export function classifiable(m: Partial<RuleInput>): boolean {
	return m.lastChaseEnd !== undefined;
}

/** The last chase was still running when the power ended (turned with less than 0.2 s left, after the end, or never). */
export function stayedOn(m: Pick<RuleInput, 'lastChaseEnd' | 'turnLeft'>): boolean {
	if (m.lastChaseEnd === 'open') return true;
	return m.lastChaseEnd === 'turn' && m.turnLeft !== null && m.turnLeft < TIMELY[0];
}

/**
 * Outcome of a trial, first that applies:
 * 1. interrupted: the power did not run out by itself.
 * 2. caught: died within 3 s after the end to a ghost that had been scared, and was within 5 tiles
 *    of a ghost that had just turned dangerous when the power ended.
 * 3. not engaged (no chase in the warning window): early retreat if they turned with more than 2 s
 *    left while a ghost was reachable (kept, but outside the rates), otherwise not engaged.
 * 4. The final decision, from how the last chase ended:
 *    eat -> catch; still running at the end -> overstayed; turned 0.2-2 s left -> timely retreat;
 *    turned more than 2 s left with a ghost reachable -> early retreat; anything else -> other.
 * A death after the end that does not meet rule 2 leaves the class as it is.
 */
export function classify(m: RuleInput): Outcome {
	if (m.endReason !== 'expired') return 'interrupted';
	if (m.after.caught && m.endDist !== null && m.endDist <= CAUGHT_DIST) return 'caught';
	const end = m.lastChaseEnd ?? null;
	const turned = end === 'turn' && m.turnLeft !== null;
	if (!m.engaged) return turned && m.turnLeft! > TIMELY[1] && m.turnReachable ? 'early-retreat' : 'not-engaged';
	if (end === 'eat') return 'catch';
	if (stayedOn(m)) return 'overstayed';
	if (turned && m.turnLeft! <= TIMELY[1]) return 'timely-retreat';
	if (turned && m.turnReachable) return 'early-retreat';
	return 'other';
}

/** A catch made with 1.5 s or less left (for a catch, `turnLeft` is the power left at the eat). */
export function isLateCatch(m: { outcome: string; turnLeft: number | null }): boolean {
	return m.outcome === 'catch' && m.turnLeft !== null && m.turnLeft <= LATE;
}

/** Counts toward the rates: classified under the current rules, eligible (`inRates`) and a decision. */
export function isDecision(t: { outcome: string; inRates: boolean; rulesVersion?: number }): boolean {
	return t.rulesVersion === RULES_VERSION && t.inRates && (DECISIONS as readonly string[]).includes(t.outcome);
}

/** Eligible engaged trial under the current rules (the denominator of the catch share). */
export function isCountedEngaged(t: { inRates: boolean; rulesVersion?: number }): boolean {
	return t.rulesVersion === RULES_VERSION && t.inRates;
}

/**
 * The derived fields of a stored trial, recomputed from its raw measures: outcome, rules version
 * and wasted power. A row without the measures these rules need keeps its outcome and is marked
 * rules version 1, which keeps it out of every rate.
 */
export function rescore<T extends RuleInput & { outcome: string; wasted: number | null }>(t: T): { outcome: T['outcome'] | Outcome; rulesVersion: number; wasted: number | null } {
	if (!classifiable(t)) return { outcome: t.outcome, rulesVersion: 1, wasted: t.wasted };
	const outcome = classify(t);
	return { outcome, rulesVersion: RULES_VERSION, wasted: outcome === 'early-retreat' ? t.turnLeft : null };
}
