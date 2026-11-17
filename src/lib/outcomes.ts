/**
 * The one vocabulary for trial outcomes, used by every page (console, live panel, run summary,
 * replays, dashboard, simulator). Change wording here and nowhere else.
 *
 * The rules that pick an outcome live in convex/lib/rules.ts; docs/STUDY.md defines them.
 * No Svelte or DOM imports, so tests and Convex-adjacent code can use it.
 */
import type { LegacyOutcome, Outcome } from '#convex/lib/rules.ts';

export type { Outcome, LegacyOutcome };
/** Any outcome a stored row can carry, including classes of older rules. */
export type AnyOutcome = Outcome | LegacyOutcome;

/** good: judged the end well. warn: misjudged it but survived. bad: caught. neutral: no decision to judge. */
export type OutcomeTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface OutcomeInfo {
	id: AnyOutcome;
	/** Full label, sentence case: "Turned away in time". */
	label: string;
	/** Short label for tight spots (legends, table cells): "In time". */
	short: string;
	/** One plain sentence saying what it means. */
	def: string;
	tone: OutcomeTone;
	/** CSS colour (a token with its fallback, so it works on pages that do not load the chart tokens). */
	color: string;
	/** A decision about the end: part of the rates' denominator. */
	decision: boolean;
}

const C = {
	caught: 'var(--o-caught, #e34948)',
	overstayed: 'var(--o-overstayed, #eda100)',
	well: 'var(--o-well, #1baf7a)',
	early: 'var(--o-early, #9085e9)',
	other: 'var(--o-other, #56607e)',
	idle: 'var(--o-idle, #36415f)'
};

export const OUTCOME_INFO: Record<AnyOutcome, OutcomeInfo> = {
	caught: {
		id: 'caught', label: 'Caught', short: 'Caught', tone: 'bad', color: C.caught, decision: true,
		def: 'Was within 5 tiles of a ghost that had just turned dangerous when the power ran out, and was caught within 3 s.'
	},
	overstayed: {
		id: 'overstayed', label: 'Stayed too long', short: 'Too long', tone: 'warn', color: C.overstayed, decision: true,
		def: 'Was still chasing a ghost within 5 tiles when the power ran out (turned with less than 0.2 s left, after the end, or never), but was not caught.'
	},
	'timely-retreat': {
		id: 'timely-retreat', label: 'Turned away in time', short: 'In time', tone: 'good', color: C.well, decision: true,
		def: 'Turned away from a ghost it could still reach, with 0.2 to 2 s of power left.'
	},
	'early-retreat': {
		id: 'early-retreat', label: 'Turned away too early', short: 'Too early', tone: 'warn', color: C.early, decision: true,
		def: 'Turned away from a ghost it could still reach, with more than 2 s left, and chased nothing after it: power wasted.'
	},
	catch: {
		id: 'catch', label: 'Ate the ghost', short: 'Ate ghost', tone: 'neutral', color: C.other, decision: false,
		def: 'The last chase ended by eating the ghost. Shows no decision about the end, so it is in no rate.'
	},
	'not-engaged': {
		id: 'not-engaged', label: 'Not chasing near the end', short: 'Not chasing', tone: 'neutral', color: C.idle, decision: false,
		def: 'Was not chasing a ghost in the last 3 s of the power, and gave none up before. Kept, but in no rate.'
	},
	interrupted: {
		id: 'interrupted', label: 'Cut short', short: 'Cut short', tone: 'neutral', color: C.idle, decision: false,
		def: 'The power did not run out by itself (a death, a cleared level, or the run ended), so there is no end to judge.'
	},
	other: {
		id: 'other', label: 'Other', short: 'Other', tone: 'neutral', color: C.other, decision: false,
		def: 'Was chasing in the last 3 s, but it shows no decision: still chasing a ghost more than 5 tiles off when the power ran out, or turned away from one that could no longer be reached. In no rate.'
	},
	'late-catch': {
		id: 'late-catch', label: 'Late catch (older rules)', short: 'Older rules', tone: 'neutral', color: C.other, decision: false,
		def: 'Classed by older rules that lacked a measure the current rules need. In no rate.'
	}
};

/** Display order: the decisions in the order time runs (too early to too late), then the rest. */
export const OUTCOME_ORDER: Outcome[] = [
	'early-retreat', 'timely-retreat', 'overstayed', 'caught', 'catch', 'other', 'not-engaged', 'interrupted'
];

/** Plain label per current outcome. */
export const OUTCOME_LABEL: Record<Outcome, string> = Object.fromEntries(
	OUTCOME_ORDER.map((o) => [o, OUTCOME_INFO[o].label])
) as Record<Outcome, string>;

const unknown = (o: string): OutcomeInfo => ({
	id: o as AnyOutcome, label: o, short: o, def: '', tone: 'neutral', color: C.other, decision: false
});

/** Everything about an outcome; unknown strings fall back to a neutral entry carrying the raw name. */
export const outcomeInfo = (o: string): OutcomeInfo => OUTCOME_INFO[o as AnyOutcome] ?? unknown(o);
export const outcomeLabel = (o: string): string => outcomeInfo(o).label;
export const outcomeShort = (o: string): string => outcomeInfo(o).short;
export const outcomeDef = (o: string): string => outcomeInfo(o).def;
export const outcomeTone = (o: string): OutcomeTone => outcomeInfo(o).tone;
export const outcomeColor = (o: string): string => outcomeInfo(o).color;

/** "2 turned away in time, 1 caught" (largest first, lower case), or "" when empty. */
export function outcomeMix(counts: Record<string, number>, max = 3): string {
	const ids = [...OUTCOME_ORDER, 'late-catch' as const];
	const parts = ids
		.filter((o) => (counts[o] ?? 0) > 0)
		.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
		.map((o) => `${counts[o]} ${OUTCOME_INFO[o].label.toLowerCase()}`);
	return parts.length > max ? `${parts.slice(0, max).join(', ')}, ...` : parts.join(', ');
}

/**
 * What to call a death. Only a trial classed `caught` was "Caught"; any other death (during the
 * power, or after the end but too far from a ghost that just turned) is "Died".
 */
export const DIED = 'Died';
export const deathLabel = (outcome: string): string => (outcome === 'caught' ? OUTCOME_INFO.caught.label : DIED);

/** The two rules modes, by their stored id. */
export const MODE_LABEL: Record<'study' | 'arcade', string> = {
	study: 'Study rules',
	arcade: 'Arcade rules'
};
export const modeLabel = (mode: string | null | undefined): string =>
	MODE_LABEL[mode as 'study' | 'arcade'] ?? (mode ? mode : 'Unknown rules');

/** Seconds for people: one decimal, two under 0.1 s so a near miss never reads "0.0 s". */
export function secs(x: number): string {
	const a = Math.abs(x);
	return `${a < 0.1 && a > 0 ? a.toFixed(2) : a.toFixed(1)} s`;
}

/**
 * The turn-away (or eat) moment in words, for tables and lists: "1.4 s left", "0.05 s late",
 * "ate it with 1.1 s left"; null when there is none or it means nothing (cut short).
 */
export function turnWords(outcome: string, turnLeft: number | null, lastChaseEnd?: string | null): string | null {
	if (turnLeft === null || outcome === 'interrupted') return null;
	if (outcome === 'catch' || lastChaseEnd === 'eat') return `ate it with ${secs(turnLeft)} left`;
	return turnLeft >= 0 ? `${secs(turnLeft)} left` : `${secs(turnLeft)} late`;
}
