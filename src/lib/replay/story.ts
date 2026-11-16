/**
 * Plain-words captions for a replay: what each outcome means, and one sentence telling what the
 * player did around the end of this power-up. Definitions follow docs/STUDY.md.
 */
import { OUTCOME_INFO, OUTCOME_LABEL, OUTCOME_ORDER, outcomeLabel, type AnyOutcome, type OutcomeTone } from '../outcomes';
import type { Outcome } from '../telemetry/types';
import { RULES_VERSION } from '#convex/lib/rules.ts';

export { OUTCOME_LABEL, OUTCOME_ORDER, outcomeLabel };
type Any = AnyOutcome;

export const GHOST_NAME: Record<string, string> = {
	hunter: 'Hunter',
	ambusher: 'Ambusher',
	guard: 'Guard',
	drifter: 'Drifter'
};
export const ghostName = (id: string | null | undefined) => (id ? (GHOST_NAME[id] ?? id) : null);

/** What each outcome class means, in one short sentence (from the shared table in src/lib/outcomes.ts). */
export const OUTCOME_MEANING = Object.fromEntries(Object.values(OUTCOME_INFO).map((o) => [o.id, o.def])) as Record<Any, string>;

export type Tone = OutcomeTone;
export const OUTCOME_TONE = Object.fromEntries(Object.values(OUTCOME_INFO).map((o) => [o.id, o.tone])) as Record<Any, Tone>;

/** One decimal, two under 0.1 s so a near miss never reads "0.0". */
const s1 = (x: number) => (Math.abs(x) < 0.1 && x !== 0 ? x.toFixed(2) : (Math.round(x * 10) / 10).toFixed(1));
const s2 = (x: number) => x.toFixed(2);

/** "1.4 s left" or "0.6 s after the end". */
export function leftWords(left: number, digits = 1): string {
	const f = digits === 2 ? s2 : s1;
	if (Math.abs(left) < 0.005) return 'at the end';
	return left > 0 ? `${f(left)} s left` : `${f(-left)} s after the end`;
}

/** Signed seconds left for compact readouts: "1.42", "-0.30". */
export const signed = (left: number, digits = 2) => (left < 0 ? '−' : '') + Math.abs(left).toFixed(digits);

/** The trial fields the story needs (a `trials.get` row has all of them). */
export interface StoryTrial {
	outcome: Outcome | string;
	/** Rules version the outcome was computed with; below 2 the sentence says so. */
	rulesVersion?: number;
	total: number;
	endReason: string;
	turnLeft: number | null;
	turnDist: number | null;
	endDist: number | null;
	eats: { t: number; left: number; ghost: string }[];
	allEatenLeft: number | null;
	wasted: number | null;
	reaction: number | null;
	after: { died: boolean; caught: boolean; timeToCaught: number | null; killer: string | null; nearMiss: boolean; minDangerDist: number | null; cut?: string | null };
}

/**
 * One sentence about what happened. `turnGhost` / `endGhost` name the ghost the player was up
 * against at the turn and at the end (worked out from the clip); without them the sentence falls
 * back to the killer or the last ghost eaten.
 */
export function describe(t: StoryTrial, opts: { turnGhost?: string | null; endGhost?: string | null } = {}): string {
	const a = t.after;
	const killer = ghostName(a.killer);
	const lastEat = t.eats.length ? t.eats[t.eats.length - 1] : null;
	const the = (name: string | null | undefined) => (name ? `the ${name}` : 'a ghost');
	const turnG = the(ghostName(opts.turnGhost) ?? killer);
	const endG = the(ghostName(opts.endGhost) ?? ghostName(opts.turnGhost) ?? killer);
	const tiles = (d: number | null) => (d === null ? '' : `, ${s1(d)} tiles away`);
	const caughtTail = a.timeToCaught !== null ? `${s1(a.timeToCaught)} s after the power ended` : 'after the power ended';

	const old = t.rulesVersion !== undefined && t.rulesVersion !== RULES_VERSION ? ' (Classed by older rules; not in the rates.)' : '';
	return said(t, a, { killer, lastEat, turnG, endG, tiles, caughtTail }) + old;
}

function said(
	t: StoryTrial, a: StoryTrial['after'],
	w: { killer: string | null; lastEat: StoryTrial['eats'][number] | null; turnG: string; endG: string; tiles: (d: number | null) => string; caughtTail: string }
): string {
	const { killer, lastEat, turnG, endG, tiles, caughtTail } = w;
	// A death after the end that does not count as "caught" (too far away when the power ended, or a
	// ghost that had not been scared) leaves the class as it is; say what happened anyway.
	const afterDeath = !a.died ? ''
		: a.caught
			? `; then died${killer ? ` to the ${killer}` : ''} ${caughtTail}, but had been too far from it when the power ran out for that to count as caught`
			: '; later died to a ghost that had not been scared';
	switch (t.outcome) {
		case 'caught': {
			const by = killer ? ` by the ${killer}` : '';
			if (t.turnLeft !== null && t.turnLeft < 0) {
				const later = a.timeToCaught !== null ? ` ${s1(Math.max(0, a.timeToCaught + t.turnLeft))} s later` : '';
				return `Kept chasing ${turnG} until ${s1(-t.turnLeft)} s after the power ended${tiles(t.turnDist)}, and was caught${by}${later}.`;
			}
			if (t.turnLeft !== null && t.turnLeft < 0.2) {
				return `Was still closing in on ${turnG} when the power ran out${tiles(t.endDist)}, and was caught${by} ${caughtTail}.`;
			}
			if (t.turnLeft !== null) {
				return `Turned away from ${turnG} with ${s1(t.turnLeft)} s left, but was still ${t.endDist !== null ? `${s1(t.endDist)} tiles` : 'close'} from a ghost when the power ran out, and was caught${by} ${caughtTail}.`;
			}
			return `Was ${t.endDist !== null ? s1(t.endDist) + ' tiles' : 'close'} from ${endG} when the power ran out, and was caught${by} ${caughtTail}.`;
		}
		case 'catch':
		case 'late-catch': {
			const ate = lastEat ? `Caught the ${ghostName(lastEat.ghost)} with ${s1(lastEat.left)} s left${lastEat.left <= 1.5 ? ' (a late catch)' : ''}` : 'Caught the ghost';
			const tail = a.died ? `, then was caught ${caughtTail}` : a.nearMiss ? ', then got away with a near miss' : ', then got away';
			return `${ate} and chased nothing after it${tail}. A catch shows no decision about the end, so it is in no rate.`;
		}
		case 'overstayed': {
			const near = a.nearMiss && a.minDangerDist !== null ? ` with a near miss (${s1(a.minDangerDist)} tiles)` : '';
			const react = t.reaction === null ? '' : t.reaction < 0.05 ? ', moved away right as it ran out' : `, moved away ${s1(t.reaction)} s after it ran out`;
			const when = t.turnLeft === null ? '' : t.turnLeft < 0 ? ` (turned ${s1(-t.turnLeft)} s after the end)` : t.turnLeft > 0.005 ? ` (turned with only ${s1(t.turnLeft)} s left)` : '';
			const tail = a.died ? afterDeath : `, and got away${near}`;
			return `Stayed too long: was still chasing ${endG} when the power ran out${tiles(t.endDist)}${when}${react}${tail}.`;
		}
		case 'timely-retreat':
			return `Turned away from ${turnG} in time, with ${s1(t.turnLeft ?? 0)} s left${tiles(t.turnDist)}${a.died ? afterDeath : ', and was clear when the ghosts turned dangerous'}.`;
		case 'early-retreat': {
			const waste = t.wasted !== null ? `, leaving ${s1(t.wasted)} s of power unused` : '';
			return `Turned away too early: gave up chasing ${turnG} with ${s1(t.turnLeft ?? 0)} s left${tiles(t.turnDist)} while a ghost was still in reach${waste}${afterDeath}.`;
		}
		case 'not-engaged':
			return `Was not chasing in the last 3 s of the ${s1(t.total)} s power, so there is no ending to judge.`;
		case 'other':
			return 'Was chasing near the end, but none of the classes fits.';
		case 'interrupted': {
			const why: Record<string, string> = {
				died: 'The player was caught while the power was still on',
				cleared: 'The maze was cleared before the power ran out',
				refreshed: 'A second power dot restarted the power',
				quit: 'The player left before the power ran out'
			};
			const w = why[t.endReason] ?? (a.cut === 'quit' ? 'The player left during the seconds after the end' : 'The power did not run out by itself');
			return `${w}, so there is no ending to judge.`;
		}
		default:
			return '';
	}
}

/** Relative time for lists: "just now", "5 min ago", "3 h ago", or a date. */
export function ago(ms: number, now = Date.now()): string {
	const s = Math.max(0, (now - ms) / 1000);
	if (s < 45) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * When the power-up ended, in game time, robust to rows written before the stored end time was
 * fixed: a "player left" trial could carry an end long before its start. Such ends fall back to
 * the start plus the power length (or the last moment the clip saw, when that is earlier).
 */
export function endTimeOf(t: { startedAt: number; endedAt: number; total: number }, lastSeen?: number): number {
	const latest = t.startedAt + t.total;
	if (t.endedAt >= t.startedAt - 1e-6 && t.endedAt <= latest + 0.05) return t.endedAt;
	return lastSeen !== undefined && lastSeen > t.startedAt ? Math.min(latest, lastSeen) : latest;
}
