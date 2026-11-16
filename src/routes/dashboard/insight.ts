/**
 * The takeaway sentences at the top of the dashboard, generated from the data and never stronger
 * than the data allows:
 * - fewer than ENOUGH counted trials: the condition is not ranked and not named as a leader;
 * - a difference is called "clear" only when the two 95% intervals (participant-clustered, or Wilson
 *   below 3 people) do not overlap (a strict, conservative test); otherwise the text says they overlap.
 * - rates are over decision trials (convex/lib/rules.ts); "counted" means decision trials.
 * Pure, so it can be tested (insight.test.ts).
 */

export const ENOUGH = 10;

export interface RateLike {
	k: number;
	n: number;
	rate: number | null;
	lo: number | null;
	hi: number | null;
}
export interface CondStats {
	cue: string;
	/** Decision trials: the denominator of every rate. */
	decisions: number;
	/** Turned away in time (the headline). */
	wellTimed: RateLike;
	/** Stayed too long or caught. */
	tooLate: RateLike;
	/** Turned away too early. */
	tooEarly: RateLike;
	caught: RateLike;
}
export interface Named {
	code: string;
	name: string;
	role: 'reference' | 'baseline' | 'idea';
}

export type Tone = 'empty' | 'thin' | 'one' | 'overlap' | 'partial' | 'clear';

export interface Insight {
	tone: Tone;
	/** One sentence, the answer as strongly as the data allows. */
	headline: string;
	/** Supporting sentences (yardsticks, failures, what is missing). */
	details: string[];
	/** Conditions ranked (enough data), best well-timed rate first. */
	ranked: string[];
	/** Ideas whose interval sits entirely above each yardstick's. */
	beats: Record<string, string[]>;
}

const p = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
/** Interval of a sits entirely above b's. */
export const clearlyAbove = (a: RateLike, b: RateLike) => a.lo !== null && b.hi !== null && a.lo > b.hi;
/** Interval of a sits entirely below b's. */
export const clearlyBelow = (a: RateLike, b: RateLike) => a.hi !== null && b.lo !== null && a.hi < b.lo;

function list(xs: string[]): string {
	if (xs.length <= 1) return xs.join('');
	return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function insight(stats: CondStats[], named: (id: string) => Named, allIds: string[]): Insight {
	const byId = new Map(stats.map((s) => [s.cue, s]));
	const label = (id: string) => `${named(id).name} (${named(id).code})`;
	const ranked = stats
		.filter((s) => s.decisions >= ENOUGH && s.wellTimed.rate !== null)
		.sort((a, b) => (b.wellTimed.rate ?? 0) - (a.wellTimed.rate ?? 0) || b.decisions - a.decisions)
		.map((s) => s.cue);
	const thin = allIds.filter((id) => (byId.get(id)?.decisions ?? 0) < ENOUGH);
	const yard = ['none', 'classic-blink', 'timer-bar'];
	const beats: Record<string, string[]> = {};
	for (const y of yard) {
		const ys = byId.get(y);
		beats[y] = ys && ys.decisions >= ENOUGH
			? ranked.filter((id) => named(id).role === 'idea' && clearlyAbove(byId.get(id)!.wellTimed, ys.wellTimed))
			: [];
	}
	const thinNote = thin.length
		? `${thin.length} of ${allIds.length} conditions have fewer than ${ENOUGH} counted power-ups and are not ranked yet.`
		: '';

	const total = stats.reduce((a, s) => a + s.decisions, 0);
	if (total === 0) {
		return { tone: 'empty', headline: 'No counted power-ups yet, so there is no answer yet.', details: [], ranked, beats };
	}
	if (ranked.length === 0) {
		const most = [...stats].sort((a, b) => b.decisions - a.decisions)[0];
		return {
			tone: 'thin',
			headline: `Not enough data yet: no condition has ${ENOUGH} counted power-ups.`,
			details: [
				`${total} counted so far; the most for one condition is ${most.decisions} (${label(most.cue)}). Rates are shown but not ranked.`
			],
			ranked, beats
		};
	}
	if (ranked.length === 1) {
		const s = byId.get(ranked[0])!;
		return {
			tone: 'one',
			headline: `Only ${label(s.cue)} has enough data so far (${s.wellTimed.n} counted, ${p(s.wellTimed.rate)} well timed). Nothing to compare yet.`,
			details: thinNote ? [thinNote] : [],
			ranked, beats
		};
	}

	const top = byId.get(ranked[0])!;
	const others = ranked.slice(1).map((id) => byId.get(id)!);
	const overlapping = others.filter((o) => !clearlyAbove(top.wellTimed, o.wellTimed));
	const clearOver = others.filter((o) => clearlyAbove(top.wellTimed, o.wellTimed));
	let tone: Tone, headline: string;
	if (overlapping.length === 0) {
		tone = 'clear';
		headline = `${label(top.cue)} tells players best: ${p(top.wellTimed.rate)} of decisions turned away in time, clearly ahead of every other condition.`;
	} else if (clearOver.length > 0) {
		tone = 'partial';
		headline = `${label(top.cue)} is ahead with ${p(top.wellTimed.rate)} well timed, but its interval still overlaps ${overlapping.length === 1 ? label(overlapping[0].cue) : `${overlapping.length} other conditions`}, so it is not a clear winner.`;
	} else {
		tone = 'overlap';
		headline = `${label(top.cue)} is ahead with ${p(top.wellTimed.rate)} well timed, but the intervals overlap, so no condition is clearly best yet.`;
	}

	const details: string[] = [];
	// The yardsticks.
	const ys = yard.map((y) => byId.get(y)).filter((s): s is CondStats => !!s && s.decisions >= ENOUGH);
	if (ys.length) {
		details.push(`Yardsticks: ${list(ys.map((s) => `${named(s.cue).name.toLowerCase()} ${p(s.wellTimed.rate)}`))} well timed.`);
	}
	const ideasRanked = ranked.filter((id) => named(id).role === 'idea').length;
	for (const y of ['timer-bar', 'classic-blink', 'none']) {
		const ysy = byId.get(y);
		if (!ysy || ysy.decisions < ENOUGH || !ideasRanked) continue;
		const b = beats[y];
		details.push(b.length
			? `${b.length} of ${ideasRanked} ranked ideas ${b.length === 1 ? 'is' : 'are'} clearly better than the ${named(y).name.toLowerCase()}: ${list(b.map((id) => label(id)))}.`
			: `No idea is clearly better than the ${named(y).name.toLowerCase()} yet.`);
		break;
	}
	// The two ways to misjudge the end: too late (stayed too long or caught) and too early.
	const lateRank = ranked.map((id) => byId.get(id)!).filter((s) => s.tooLate.rate !== null)
		.sort((a, b) => (a.tooLate.rate ?? 0) - (b.tooLate.rate ?? 0));
	if (lateRank.length >= 2) {
		const lo = lateRank[0], hi = lateRank[lateRank.length - 1];
		details.push(clearlyBelow(lo.tooLate, hi.tooLate)
			? `Fewest too late: ${label(lo.cue)} at ${p(lo.tooLate.rate)} (${p(lo.caught.rate)} caught), clearly fewer than ${label(hi.cue)} at ${p(hi.tooLate.rate)} (${p(hi.caught.rate)} caught).`
			: `Too late ranges from ${p(lo.tooLate.rate)} (${label(lo.cue)}) to ${p(hi.tooLate.rate)} (${label(hi.cue)}), with overlapping intervals.`);
	}
	const earlyRank = ranked.map((id) => byId.get(id)!).filter((s) => s.tooEarly.rate !== null)
		.sort((a, b) => (a.tooEarly.rate ?? 0) - (b.tooEarly.rate ?? 0));
	if (earlyRank.length >= 2) {
		const lo = earlyRank[0], hi = earlyRank[earlyRank.length - 1];
		details.push(clearlyBelow(lo.tooEarly, hi.tooEarly)
			? `Fewest too early: ${label(lo.cue)} at ${p(lo.tooEarly.rate)}, clearly fewer than ${label(hi.cue)} at ${p(hi.tooEarly.rate)}.`
			: `Too early ranges from ${p(lo.tooEarly.rate)} (${label(lo.cue)}) to ${p(hi.tooEarly.rate)} (${label(hi.cue)}), with overlapping intervals.`);
	}
	if (thinNote) details.push(thinNote);
	return { tone, headline, details, ranked, beats };
}
