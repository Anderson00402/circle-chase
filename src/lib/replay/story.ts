/**
 * Plain-words captions for a replay: what each outcome means, and one sentence telling what the
 * player did around the end of this power-up. Definitions follow docs/STUDY.md.
 */
import { OUTCOME_INFO, OUTCOME_LABEL, OUTCOME_ORDER, outcomeLabel, type AnyOutcome, type OutcomeTone } from '../outcomes';
import type { Outcome } from '../telemetry/types';
import { CAUGHT_DIST, OVERSTAY_DIST, RULES_VERSION } from '#convex/lib/rules.ts';

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

/**
 * A distance in tiles for people: "4.1 tiles". Near a rule's line (the 5 tiles that decide caught
 * and stayed too long) it shows two decimals, so "5.05" never reads "5.0" next to "more than 5".
 * A missing value is "-", never "-tiles".
 */
export function tilesNum(d: number | null | undefined): string {
	if (d === null || d === undefined || !Number.isFinite(d)) return '-';
	// Within this of the line, one decimal could round across it (4.96 and 5.05 both read "5.0").
	const nearLine = Math.abs(d - CAUGHT_DIST) <= 0.065 || Math.abs(d - OVERSTAY_DIST) <= 0.065;
	return nearLine && Math.abs(d - Math.round(d)) > 0.004 ? d.toFixed(2) : s1(d);
}
export const tilesText = (d: number | null | undefined): string => (d === null || d === undefined || !Number.isFinite(d) ? '-' : `${tilesNum(d)} tiles`);

/** The two distances at the end differ enough to be told apart (as printed). */
export const distancesDiffer = (a: number | null | undefined, b: number | null | undefined) =>
	a != null && b != null && tilesNum(a) !== tilesNum(b);

/** Signed seconds left for compact readouts: "1.42", "-0.30". */
export const signed = (left: number, digits = 2) => (left < 0 ? '−' : '') + Math.abs(left).toFixed(digits);

/** The trial fields the story needs (a `trials.get` row has all of them). */
export interface StoryTrial {
	outcome: Outcome | string;
	/** Rules version the outcome was computed with; below the current one the sentence says so. */
	rulesVersion?: number;
	total: number;
	endReason: string;
	turnLeft: number | null;
	turnDist: number | null;
	endDist: number | null;
	/** How the last chase ended: 'turn', 'eat', 'open' (still running), or null without a chase. */
	lastChaseEnd?: string | null;
	/** Distance to the last chase's ghost when the power ran out (rules version 3). */
	chaseEndDist?: number | null;
	/** The last chase's ghost (rules version 3); preferred over the clip's guess for naming it. */
	chaseGhost?: string | null;
	eats: { t: number; left: number; ghost: string }[];
	allEatenLeft: number | null;
	wasted: number | null;
	reaction: number | null;
	after: { died: boolean; caught: boolean; timeToCaught: number | null; killer: string | null; nearMiss: boolean; minDangerDist: number | null; cut?: string | null; seen?: number };
}

/**
 * One sentence about what happened, matching the board, the markers and the key numbers:
 * - a last chase that ended by eating the ghost is told as an eat, never as a turn-away;
 * - a death is "caught" only in a trial classed caught, "died" otherwise, and is told in every class;
 * - "other" says which of its two cases it was.
 * `turnGhost` / `endGhost` name the ghost the player was up against at the turn and at the end
 * (worked out from the clip); without them the sentence falls back to the killer or the last ghost eaten.
 */
export function describe(t: StoryTrial, opts: { turnGhost?: string | null; endGhost?: string | null } = {}): string {
	const old = t.rulesVersion !== undefined && t.rulesVersion !== RULES_VERSION ? ' (Classed by older rules; not in the rates.)' : '';
	return said(t, opts) + old;
}

function said(t: StoryTrial, opts: { turnGhost?: string | null; endGhost?: string | null }): string {
	const a = t.after;
	const killer = ghostName(a.killer);
	const lastEat = t.eats.length ? t.eats[t.eats.length - 1] : null;
	const the = (name: string | null | undefined) => (name ? `the ${name}` : 'a ghost');
	// The ghost of the last chase is stored with the trial; the clip's guess is the fallback for older rows.
	const chased = ghostName(t.chaseGhost);
	const turnG = the(chased ?? ghostName(opts.turnGhost) ?? killer);
	const endG = the(chased ?? ghostName(opts.endGhost) ?? ghostName(opts.turnGhost) ?? killer);
	const tiles = (d: number | null | undefined) => (d === null || d === undefined ? '' : `, ${tilesText(d)} away`);
	/**
	 * The distance to the chased ghost at the end, and the nearest dangerous ghost when that is a
	 * different number: the readouts and Key numbers show the nearest one, so the sentence names both.
	 */
	const chaseAtEnd = (d: number | null | undefined) => {
		const own = d ?? null;
		if (own === null) return t.endDist !== null ? `, with the nearest ghost ${tilesText(t.endDist)} away` : '';
		return tiles(own) + (distancesDiffer(own, t.endDist) ? `, and the nearest ghost was ${tilesText(t.endDist)} away` : '');
	};
	// When the death came: the time to the catch, else the end of what was seen (the death closes the trial).
	const deathAt = a.timeToCaught ?? (a.died && a.seen !== undefined ? a.seen : null);
	// The same frame as the end reads "as the power ran out", never "0.0 s after".
	const after = deathAt === null ? 'after the power ended' : deathAt < 0.005 ? 'as the power ran out' : `${s1(deathAt)} s after the power ended`;
	const by = killer ? ` by the ${killer}` : '';
	const to = killer ? ` to the ${killer}` : '';
	const ateLast = t.lastChaseEnd === 'eat' || t.outcome === 'catch';
	/** The eat that ended the last chase. */
	const ate = lastEat ? `Ate the ${ghostName(lastEat.ghost)} with ${s1(lastEat.left)} s left${lastEat.left <= 1.5 ? ' (a late catch)' : ''}` : 'Ate the ghost';
	// A death after the end in a trial not classed caught: say it, with the word "died".
	const died = !a.died ? ''
		: a.caught
			? `; then died${to} ${after}, but was ${t.endDist !== null ? `${tilesText(t.endDist)} from the nearest dangerous ghost when the power ran out (more than ${CAUGHT_DIST})` : `more than ${CAUGHT_DIST} tiles from a dangerous ghost when the power ran out`}, so it does not count as caught`
			: killer ? `; then died to the ${killer} ${after}, a ghost that had not been scared` : `; then died ${after} to a ghost that had not been scared`;

	switch (t.outcome) {
		case 'interrupted': {
			const why: Record<string, string> = {
				died: `Died${to} while the power was still on`,
				cleared: 'The maze was cleared before the power ran out',
				refreshed: 'A second power dot restarted the power',
				quit: 'The run ended before the power ran out'
			};
			const w = why[t.endReason] ?? (a.cut === 'quit' ? 'The run ended during the seconds after the end' : 'The power did not run out by itself');
			return `${w}, so there is no ending to judge.`;
		}
		case 'caught': {
			const near = `was ${t.endDist !== null ? tilesText(t.endDist) : 'close'} from a ghost that had just turned dangerous when the power ran out, and was caught${by} ${after}`;
			if (ateLast) return `${ate} and chased nothing after it, but ${near}.`;
			if (t.lastChaseEnd === null || (t.lastChaseEnd === undefined && t.turnLeft === null)) return `Was not chasing near the end, but ${near}.`;
			if (t.turnLeft !== null && t.turnLeft < 0) {
				const gap = a.timeToCaught !== null ? Math.max(0, a.timeToCaught + t.turnLeft) : null;
				const later = gap === null ? '' : gap < 0.005 ? ' right then' : ` ${s1(gap)} s later`;
				return `Kept chasing ${turnG} until ${s1(-t.turnLeft)} s after the power ended${tiles(t.turnDist)}, and was caught${by}${later}.`;
			}
			if (t.turnLeft === null || t.turnLeft < 0.2) return `Was still closing in on ${turnG} when the power ran out${chaseAtEnd(t.chaseEndDist)}, and was caught${by} ${after}.`;
			return `Turned away from ${turnG} with ${s1(t.turnLeft)} s left, but ${near}.`;
		}
		case 'catch':
		case 'late-catch': {
			const tail = a.died ? died : a.nearMiss ? ', then got away with a near miss' : ', then got away';
			return `${ate} and chased nothing after it${tail}. A catch shows no decision about the end, so it is in no rate.`;
		}
		case 'overstayed': {
			const near = a.nearMiss && a.minDangerDist !== null ? ` with a near miss (${tilesText(a.minDangerDist)})` : '';
			const react = t.reaction === null ? '' : t.reaction < 0.05 ? '; moved away right as it ran out' : `; moved away ${s1(t.reaction)} s after it ran out`;
			const when = t.turnLeft === null ? '' : t.turnLeft < 0 ? ` (turned ${s1(-t.turnLeft)} s after the end)` : t.turnLeft > 0.005 ? ` (turned with only ${s1(t.turnLeft)} s left)` : '';
			return `Stayed too long: was still chasing ${endG} when the power ran out${when}${chaseAtEnd(t.chaseEndDist)}${react}${a.died ? died : `, and got away${near}`}.`;
		}
		case 'timely-retreat':
			return `Turned away from ${turnG} in time, with ${s1(t.turnLeft ?? 0)} s left${tiles(t.turnDist)}${a.died ? died : ', and was clear when the ghosts turned dangerous'}.`;
		case 'early-retreat': {
			const waste = t.wasted !== null ? `, leaving ${s1(t.wasted)} s of power unused` : '';
			return `Turned away too early: gave up chasing ${turnG} with ${s1(t.turnLeft ?? 0)} s left${tiles(t.turnDist)} while it could still be reached${waste}${died}.`;
		}
		case 'not-engaged': {
			const what = ateLast ? `${ate}, before the last 3 s, and chased nothing after it`
				: t.lastChaseEnd === 'turn' && t.turnLeft !== null ? `Turned away from ${turnG} with ${s1(t.turnLeft)} s left, when it could no longer be reached, and chased nothing after it`
				: `Was not chasing a ghost in the last 3 s of the ${s1(t.total)} s power`;
			return `${what}, so there is no ending to judge${died}.`;
		}
		case 'other': {
			const still = t.lastChaseEnd === 'open' || (t.turnLeft !== null && t.turnLeft < 0.2);
			// "Too far to be a danger" only when no dangerous ghost was within reach at the end.
			const danger = t.endDist !== null && t.endDist <= CAUGHT_DIST;
			const off = t.chaseEndDist != null ? `${tilesText(t.chaseEndDist)} off` : `more than ${OVERSTAY_DIST} tiles off`;
			const what = still
				? danger
					? `Was still chasing ${endG} when the power ran out, but it was ${off}, too far to count as staying too long (the nearest ghost was ${tilesText(t.endDist)} away)`
					: `Was still chasing ${endG} when the power ran out, but it was ${off}, too far to be a danger`
				: `Turned away from ${turnG} with ${s1(t.turnLeft ?? 0)} s left, when it could no longer be reached before the power ran out`;
			return `${what}, so it shows no decision${died}.`;
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
