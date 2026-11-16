/**
 * The takeaway sentences at the top of the dashboard, generated from the data and never stronger
 * than the data allows:
 * - fewer than ENOUGH decision trials: the condition is not ranked and not named as a leader;
 * - a difference between two conditions is called "clear" only when the paired comparison (inside
 *   each person, then over people) stays below 5% after Holm's adjustment for every comparison made
 *   at once (78 pairs for 13 conditions; 12 against the timer bar). convex/lib/compare.ts computes them;
 * - when no condition is clearly ahead of every other, the headline says so first ("No condition is
 *   clearly best yet") and the highest rate comes second, as a plain fact.
 * Rates are over decision trials (convex/lib/rules.ts); "counted" means decision trials.
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

/** One paired comparison a - b (fractions), Holm-adjusted within its family. */
export interface Cmp {
	a: string;
	b: string;
	people: number;
	diff: number | null;
	clear: boolean;
}
export type CmpKey = 'wellTimed' | 'tooLate' | 'tooEarly';
export interface Comparisons {
	/** Every pair of ranked conditions, per rate (one Holm family per rate). */
	pairs: Record<CmpKey, Cmp[]>;
	/** Every condition against the timer bar on the well-timed rate (one Holm family). */
	vsTimer: Cmp[];
}

export type Tone = 'empty' | 'thin' | 'one' | 'none' | 'some' | 'clear';

export interface Insight {
	tone: Tone;
	/** One sentence, the answer as strongly as the data allows. */
	headline: string;
	/** Supporting sentences (the highest rate, what is separated, yardsticks, what is missing). */
	details: string[];
	/** Conditions ranked (enough data), best well-timed rate first. */
	ranked: string[];
	/** Ideas clearly better than the timer bar (paired, Holm-adjusted). */
	beatsTimer: string[];
	/** Pairs that differ clearly on the well-timed rate, and how many were compared. */
	separated: { k: number; of: number };
}

const p = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

function list(xs: string[]): string {
	if (xs.length <= 1) return xs.join('');
	return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** The comparison of a against b (a - b), whichever way round it was computed. */
export function lookup(cmps: Cmp[], a: string, b: string): Cmp | null {
	const c = cmps.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
	if (!c) return null;
	return c.a === a ? c : { ...c, a, b, diff: c.diff === null ? null : -c.diff };
}

/** a is clearly higher than b on this family. */
const clearlyHigher = (cmps: Cmp[], a: string, b: string) => {
	const c = lookup(cmps, a, b);
	return !!c && c.clear && (c.diff ?? 0) > 0;
};

const NO_CMP: Comparisons = { pairs: { wellTimed: [], tooLate: [], tooEarly: [] }, vsTimer: [] };

export function insight(stats: CondStats[], named: (id: string) => Named, allIds: string[], cmp: Comparisons = NO_CMP): Insight {
	const byId = new Map(stats.map((s) => [s.cue, s]));
	const label = (id: string) => `${named(id).name} (${named(id).code})`;
	const ranked = stats
		.filter((s) => s.decisions >= ENOUGH && s.wellTimed.rate !== null)
		.sort((a, b) => (b.wellTimed.rate ?? 0) - (a.wellTimed.rate ?? 0) || b.decisions - a.decisions)
		.map((s) => s.cue);
	const thin = allIds.filter((id) => (byId.get(id)?.decisions ?? 0) < ENOUGH);
	const thinNote = thin.length
		? `${thin.length} of ${allIds.length} conditions have fewer than ${ENOUGH} counted power-ups and are not ranked yet.`
		: '';
	const rankedSet = new Set(ranked);
	const wellPairs = cmp.pairs.wellTimed.filter((c) => rankedSet.has(c.a) && rankedSet.has(c.b));
	const separated = { k: wellPairs.filter((c) => c.clear).length, of: (ranked.length * (ranked.length - 1)) / 2 };
	const timer = byId.get('timer-bar');
	const beatsTimer = timer && timer.decisions >= ENOUGH
		? ranked.filter((id) => named(id).role === 'idea' && clearlyHigher(cmp.vsTimer, id, 'timer-bar'))
		: [];
	const base = { ranked, beatsTimer, separated };

	const total = stats.reduce((a, s) => a + s.decisions, 0);
	if (total === 0) {
		return { ...base, tone: 'empty', headline: 'No counted power-ups yet, so there is no answer yet.', details: [] };
	}
	if (ranked.length === 0) {
		const most = [...stats].sort((a, b) => b.decisions - a.decisions)[0];
		return {
			...base,
			tone: 'thin',
			headline: `Not enough data yet: no condition has ${ENOUGH} counted power-ups.`,
			details: [`${total} counted so far; the most for one condition is ${most.decisions} (${label(most.cue)}). Rates are shown but not ranked.`]
		};
	}
	if (ranked.length === 1) {
		const s = byId.get(ranked[0])!;
		return {
			...base,
			tone: 'one',
			headline: `Only ${label(s.cue)} has enough data so far (${s.wellTimed.n} counted, ${p(s.wellTimed.rate)} turned away in time). Nothing to compare yet.`,
			details: thinNote ? [thinNote] : []
		};
	}

	// A clear best: clearly ahead of every other ranked condition (usually the highest rate).
	const winner = ranked.find((id) => ranked.every((o) => o === id || clearlyHigher(wellPairs, id, o))) ?? null;
	const top = byId.get(ranked[0])!;
	const low = byId.get(ranked[ranked.length - 1])!;
	const m = separated.of;
	let tone: Tone, headline: string;
	const details: string[] = [];
	if (winner) {
		const w = byId.get(winner)!;
		tone = 'clear';
		headline = `${label(winner)} tells players best: ${p(w.wellTimed.rate)} of counted power-ups turned away in time, clearly ahead of every other condition, even allowing for ${m} comparisons.`;
	} else if (separated.k === 0) {
		tone = 'none';
		headline = `No condition is clearly best yet: across all ${m} pairs of conditions, no difference is larger than chance would explain.`;
		details.push(`The highest well-timed rate is ${label(top.cue)} at ${p(top.wellTimed.rate)}, the lowest ${label(low.cue)} at ${p(low.wellTimed.rate)}; with ${m} pairs compared, a gap this size is within chance.`);
	} else {
		tone = 'some';
		headline = 'No condition is clearly best yet.';
		const behindTop = ranked.filter((o) => o !== top.cue && !clearlyHigher(wellPairs, top.cue, o)).length;
		details.push(`The highest well-timed rate is ${label(top.cue)} at ${p(top.wellTimed.rate)}, but it is not clearly ahead of ${behindTop === 1 ? 'one other condition' : `${behindTop} others`}.`);
		// What is separated: who is clearly ahead of something, who is clearly behind.
		const wins = new Map<string, number>(), losses = new Map<string, number>();
		for (const c of wellPairs) {
			if (!c.clear || c.diff === null || c.diff === 0) continue;
			const [hi, lo] = c.diff > 0 ? [c.a, c.b] : [c.b, c.a];
			wins.set(hi, (wins.get(hi) ?? 0) + 1);
			losses.set(lo, (losses.get(lo) ?? 0) + 1);
		}
		const byCount = (mp: Map<string, number>) => [...mp.entries()].sort((a, b) => b[1] - a[1] || ranked.indexOf(a[0]) - ranked.indexOf(b[0]));
		const behind = byCount(losses).filter(([id]) => !wins.has(id));
		const ahead = byCount(wins).filter(([id]) => !losses.has(id));
		const part = (xs: [string, number][], word: string) => list(xs.slice(0, 4).map(([id, k]) => `${label(id)}, ${word} ${k}`)) + (xs.length > 4 ? ` and ${xs.length - 4} more` : '');
		details.push(`${separated.k} of ${m} pairs differ clearly (paired within people, adjusted for ${m} comparisons).`
			+ (ahead.length ? ` Clearly ahead of at least one other: ${part(ahead, 'ahead of')}.` : '')
			+ (behind.length ? ` Clearly behind at least one other: ${part(behind, 'behind')}.` : '')
			+ ' Every other pair could be chance.');
	}

	// The yardsticks.
	const yard = ['none', 'classic-blink', 'timer-bar'];
	const ys = yard.map((y) => byId.get(y)).filter((s): s is CondStats => !!s && s.decisions >= ENOUGH);
	if (ys.length) details.push(`Yardsticks: ${list(ys.map((s) => `${named(s.cue).name.toLowerCase()} ${p(s.wellTimed.rate)}`))} turned away in time.`);
	const ideasRanked = ranked.filter((id) => named(id).role === 'idea').length;
	if (timer && timer.decisions >= ENOUGH && ideasRanked) {
		const worse = ranked.filter((id) => id !== 'timer-bar' && clearlyHigher(cmp.vsTimer, 'timer-bar', id));
		const nT = cmp.vsTimer.length;
		const better = beatsTimer.length
			? `${beatsTimer.length} of ${ideasRanked} ranked ideas ${beatsTimer.length === 1 ? 'does' : 'do'} clearly better: ${list(beatsTimer.map(label))}`
			: 'no idea does clearly better yet';
		details.push(`Against the timer bar alone (${nT} comparisons, paired within people): ${better}${worse.length ? `; clearly worse: ${list(worse.map(label))}` : ''}.`);
	}

	// The two ways to misjudge the end: too late (stayed too long or caught) and too early.
	const spreadLine = (key: 'tooLate' | 'tooEarly', word: string) => {
		const rs = ranked.map((id) => byId.get(id)!).filter((s) => s[key].rate !== null).sort((a, b) => (a[key].rate ?? 0) - (b[key].rate ?? 0));
		if (rs.length < 2) return;
		const fam = cmp.pairs[key].filter((c) => rankedSet.has(c.a) && rankedSet.has(c.b));
		const lo = rs[0], hi = rs[rs.length - 1];
		const k = fam.filter((c) => c.clear).length;
		const caught = (s: CondStats) => (key === 'tooLate' ? ` (${p(s.caught.rate)} caught)` : '');
		if (clearlyHigher(fam, hi.cue, lo.cue)) {
			details.push(`Fewest ${word}: ${label(lo.cue)} at ${p(lo[key].rate)}${caught(lo)}, clearly fewer than ${label(hi.cue)} at ${p(hi[key].rate)}${caught(hi)}.`);
		} else {
			details.push(`${word[0].toUpperCase()}${word.slice(1)} ranges from ${p(lo[key].rate)} for ${label(lo.cue)} to ${p(hi[key].rate)} for ${label(hi.cue)}; ${k === 0 ? 'no pair differs by more than chance' : `${k} of ${m} pairs differ clearly, but not these two`}.`);
		}
	};
	spreadLine('tooLate', 'too late');
	spreadLine('tooEarly', 'too early');
	if (thinNote) details.push(thinNote);
	return { ...base, tone, headline, details };
}
