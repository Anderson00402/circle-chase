/**
 * The takeaway at the top of the dashboard, generated from the data and never stronger than the
 * data allows. It is written around groups, because that is what a within-person study with 13
 * conditions can usually say long before it can name one best:
 * - a condition is ranked only with ENOUGH decision trials from RANK_PEOPLE people;
 * - a difference between two conditions is "clear" only when the paired comparison (inside each
 *   person, then over people) stays below 5% after Holm's adjustment for its whole family (78 pairs
 *   of 13 conditions; 12 against each yardstick). convex/lib/compare.ts computes them;
 * - the top group is the highest-ranked condition and every condition not clearly behind it. When
 *   the top group is also clearly ahead of every condition outside it (each member of the one
 *   against each of the other), the headline says so; otherwise it names the group and how many are
 *   clearly behind the highest;
 * - with fewer than 5 people who played both conditions no test can run, and the page says "too
 *   few people to compare yet", never "no difference".
 * Rates are over decision trials (convex/lib/rules.ts); "counted" means decision trials.
 * Pure, so it can be tested (insight.test.ts).
 */

export const ENOUGH = 10;
/** People with counted power-ups a condition needs to be ranked (the same 5 a paired test needs). */
export const RANK_PEOPLE = 5;

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
	/** People with decision trials under this condition. */
	decisionParticipants?: number;
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
	sd?: number | null;
}
export type CmpKey = 'wellTimed' | 'tooLate' | 'tooEarly';
export type YardId = 'timer-bar' | 'classic-blink' | 'none';
export interface Comparisons {
	/** Every pair of ranked conditions, per rate (one Holm family per rate). */
	pairs: Record<CmpKey, Cmp[]>;
	/** Every condition against each yardstick on the well-timed rate (one Holm family per yardstick). */
	vs: Partial<Record<YardId, Cmp[]>>;
	/** People needed to order the top two at their observed gap, if known. */
	top?: { a: string; b: string; gap: number | null; people: number; needed: number } | null;
}

export type Tone = 'empty' | 'thin' | 'one' | 'few' | 'none' | 'group' | 'clear';

export interface Insight {
	tone: Tone;
	/** One sentence, the answer as strongly as the data allows. */
	headline: string;
	/** Supporting sentences shown with it (the groups, each yardstick, what is still undecided). */
	details: string[];
	/** Further sentences shown on request (how many pairs differ, the two ways to misjudge the end, thin conditions). */
	more: string[];
	/** Conditions ranked (enough data), best well-timed rate first. */
	ranked: string[];
	/** Ideas clearly better than the timer bar (paired, Holm-adjusted). */
	beatsTimer: string[];
	/** Pairs that differ clearly on the well-timed rate, how many could be tested, and how many were compared. */
	separated: { k: number; tested: number; of: number };
	/**
	 * The groups the ranking chart marks, in rank order: `top`, the highest and every condition not
	 * clearly behind it ("not clearly different from the best"); `behind`, clearly behind the highest;
	 * `leaders`, the longest run from the top of `top` whose members are each clearly ahead of every
	 * member of `behind` and not clearly apart from each other. `clean`: leaders and top are the same.
	 * Null when no group can be told apart.
	 */
	groups: { top: string[]; leaders: string[]; behind: string[]; clean: boolean } | null;
}

/** Fewer people who played both than this: no paired test (compare.ts PAIR_MIN_PEOPLE). */
const PAIR_PEOPLE = 5;

const p = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

export function list(xs: string[]): string {
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

const NO_CMP: Comparisons = { pairs: { wellTimed: [], tooLate: [], tooEarly: [] }, vs: {} };

/** Ranked: enough counted power-ups, from enough people (people unknown: counted alone decides). */
export const rankable = (s: CondStats) => s.decisions >= ENOUGH && (s.decisionParticipants ?? RANK_PEOPLE) >= RANK_PEOPLE;

/** The top group and who is clearly behind it, from the pairs family (rank order kept). */
export function topGroups(ranked: string[], pairs: Cmp[]): Insight['groups'] {
	if (ranked.length < 2 || !pairs.some((c) => c.clear)) return null;
	const top = ranked[0];
	const group = ranked.filter((id) => id === top || !clearlyHigher(pairs, top, id));
	const behind = ranked.filter((id) => !group.includes(id));
	if (!behind.length) return null;
	let k = 1;
	while (k < group.length) {
		const next = group.slice(0, k + 1);
		const ahead = next.every((g) => behind.every((b) => clearlyHigher(pairs, g, b)));
		const inner = next.some((x) => next.some((y) => clearlyHigher(pairs, x, y)));
		if (!ahead || inner) break;
		k++;
	}
	const leaders = group.slice(0, k);
	return { top: group, leaders, behind, clean: k === group.length };
}

export function insight(stats: CondStats[], named: (id: string) => Named, allIds: string[], cmp: Comparisons = NO_CMP): Insight {
	const byId = new Map(stats.map((s) => [s.cue, s]));
	const label = (id: string) => `${named(id).name} (${named(id).code})`;
	const nameOf = (id: string) => named(id).name;
	const ranked = stats
		.filter((s) => rankable(s) && s.wellTimed.rate !== null)
		.sort((a, b) => (b.wellTimed.rate ?? 0) - (a.wellTimed.rate ?? 0) || b.decisions - a.decisions)
		.map((s) => s.cue);
	const thin = allIds.filter((id) => !rankable(byId.get(id) ?? { cue: id, decisions: 0 } as CondStats));
	const thinNote = thin.length
		? `${thin.length} of ${allIds.length} conditions have fewer than ${ENOUGH} counted power-ups or fewer than ${RANK_PEOPLE} people and are not ranked yet.`
		: '';
	const rankedSet = new Set(ranked);
	const wellPairs = cmp.pairs.wellTimed.filter((c) => rankedSet.has(c.a) && rankedSet.has(c.b));
	const tested = wellPairs.filter((c) => c.people >= PAIR_PEOPLE).length;
	const m = (ranked.length * (ranked.length - 1)) / 2;
	const separated = { k: wellPairs.filter((c) => c.clear).length, tested, of: m };
	const timer = byId.get('timer-bar');
	const timerRanked = rankedSet.has('timer-bar');
	const vsTimer = cmp.vs['timer-bar'] ?? [];
	const beatsTimer = timerRanked ? ranked.filter((id) => named(id).role === 'idea' && clearlyHigher(vsTimer, id, 'timer-bar')) : [];
	const base = { ranked, beatsTimer, separated, groups: null as Insight['groups'], more: [] as string[] };

	const total = stats.reduce((a, s) => a + s.decisions, 0);
	const people = Math.max(0, ...stats.map((s) => s.decisionParticipants ?? 0));
	if (total === 0) {
		return { ...base, tone: 'empty', headline: 'No counted power-ups yet, so there is no answer yet.', details: [] };
	}
	if (ranked.length === 0) {
		const most = [...stats].sort((a, b) => b.decisions - a.decisions)[0];
		const fewPeople = stats.some((s) => s.decisions >= ENOUGH);
		return {
			...base,
			tone: 'thin',
			headline: fewPeople
				? `Too few people to compare conditions yet: a condition needs counted power-ups from ${RANK_PEOPLE} people, and the most so far is ${people}.`
				: `Not enough data yet: no condition has ${ENOUGH} counted power-ups.`,
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
	if (tested === 0) {
		const most = Math.max(0, ...wellPairs.map((c) => c.people));
		return {
			...base,
			tone: 'few',
			headline: `Too few people to compare conditions yet: a comparison needs ${PAIR_PEOPLE} people who played both, and the most so far is ${most}.`,
			details: [
				`Most often turned away in time: ${label(ranked[0])} at ${p(byId.get(ranked[0])!.wellTimed.rate)}; least often: ${label(ranked[ranked.length - 1])} at ${p(byId.get(ranked[ranked.length - 1])!.wellTimed.rate)}. With so few people that order can easily change.`,
				...(thinNote ? [thinNote] : [])
			]
		};
	}

	const top = byId.get(ranked[0])!;
	const low = byId.get(ranked[ranked.length - 1])!;
	const untested = m - tested;
	const untestedNote = untested ? ` (${untested} more ${untested === 1 ? 'pair has' : 'pairs have'} too few people who played both to test)` : '';
	// A clear best: clearly ahead of every other ranked condition.
	const winner = ranked.find((id) => ranked.every((o) => o === id || clearlyHigher(wellPairs, id, o))) ?? null;
	const groups = topGroups(ranked, wellPairs);
	let tone: Tone, headline: string;
	const details: string[] = [];
	const more: string[] = [];
	if (winner) {
		const w = byId.get(winner)!;
		tone = 'clear';
		headline = `${label(winner)} tells players best: ${p(w.wellTimed.rate)} of counted power-ups turned away in time, clearly ahead of every other condition, even allowing for ${m} comparisons.`;
	} else if (!groups) {
		tone = 'none';
		headline = untested
			? `No condition stands out yet: none of the ${tested} pairs of conditions that could be tested differs by more than chance (${untested} more ${untested === 1 ? 'has' : 'have'} too few people who played both).`
			: `No condition stands out yet: none of the ${m} pairs of conditions differs by more than chance would explain.`;
		details.push(`Most often turned away in time: ${label(top.cue)} at ${p(top.wellTimed.rate)}; least often: ${label(low.cue)} at ${p(low.wellTimed.rate)}. With ${m} pairs compared, a gap this size is within chance.`);
	} else {
		tone = 'group';
		const { top: g, leaders: L, behind: b, clean } = groups;
		const middle = g.filter((id) => !L.includes(id));
		const nb = b.length === 1 ? '1 other' : `${b.length} others`;
		const rated = (ids: string[]) => list(ids.map((id) => `${label(id)} ${p(byId.get(id)!.wellTimed.rate)}`));
		if (clean) {
			headline = `${list(L.map(nameOf))} are clearly ahead of the ${b.length === 1 ? 'one other condition' : `other ${b.length}`}; they cannot be told apart from each other yet.`;
		} else if (L.length > 1) {
			headline = `${list(L.map(nameOf))} lead: each is clearly ahead of ${nb}, and they cannot be told apart from each other yet.`;
		} else {
			headline = `${nameOf(L[0])} leads: it is clearly ahead of ${nb}, but not yet of ${middle.length === 1 ? '1 more' : `${middle.length} more`}.`;
		}
		if (middle.length) details.push(`Not clearly behind ${label(g[0])}, the highest, but not clearly ahead of all of the rest either: ${rated(middle)}.`);
		details.push(`Clearly behind ${L.length > 1 ? 'each of the leaders' : label(L[0])}: ${rated(b)}.`);
		more.push(`${separated.k} of ${m} pairs differ clearly on turning away in time (paired within people, adjusted for ${m} comparisons)${untestedNote}; every other pair could be chance.`);
	}

	// The yardsticks: how the ideas stand against each (each its own family of comparisons).
	const ideas = ranked.filter((id) => named(id).role === 'idea');
	const YARDS: YardId[] = ['timer-bar', 'classic-blink', 'none'];
	for (const y of YARDS) {
		const fam = cmp.vs[y];
		if (!fam || !rankedSet.has(y) || !ideas.length) continue;
		const ys = byId.get(y)!;
		const better = ideas.filter((id) => clearlyHigher(fam, id, y));
		const worse = ideas.filter((id) => clearlyHigher(fam, y, id));
		const level = ideas.length - better.length - worse.length;
		const parts: string[] = [];
		parts.push(better.length ? `${better.length} clearly better (${list(better.map(nameOf))})` : 'none clearly better');
		if (worse.length) parts.push(`${worse.length} clearly worse (${list(worse.map(nameOf))})`);
		if (level) parts.push(`${level} not told apart`);
		const the = y === 'none' ? 'no signal' : `the ${nameOf(y).toLowerCase()}`;
		details.push(`Against ${the} (${p(ys.wellTimed.rate)}), of ${ideas.length} ranked ${ideas.length === 1 ? 'idea' : 'ideas'}: ${list(parts)}.`);
	}

	// What is still undecided.
	if (tone === 'group' || tone === 'none') {
		const open: string[] = [];
		if (tone === 'group' && groups!.top.length > 1) {
			// The order of the two highest: what it would take to tell them apart.
			const t = cmp.top;
			const ask = t && t.needed && t.gap !== null && rankedSet.has(t.a) && rankedSet.has(t.b)
				? ` (${nameOf(t.a)} and ${nameOf(t.b)} are ${Math.round(Math.abs(t.gap) * 100)} points apart; telling them apart would take about ${t.needed.toLocaleString('en-GB')} people)`
				: '';
			open.push(`the order inside the top group${ask}`);
		}
		if (tone === 'none') open.push('which conditions differ at all');
		if (timerRanked && ideas.length && !beatsTimer.length) open.push('whether any idea beats the timer bar');
		if (open.length) details.push(`Still undecided: ${list(open)}.`);
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
			more.push(`Fewest ${word}: ${label(lo.cue)} at ${p(lo[key].rate)}${caught(lo)}, clearly fewer than ${label(hi.cue)} at ${p(hi[key].rate)}${caught(hi)}${k > 1 ? ` (${k} of ${m} pairs differ clearly)` : ''}.`);
		} else {
			more.push(`${word[0].toUpperCase()}${word.slice(1)} ranges from ${p(lo[key].rate)} for ${label(lo.cue)} to ${p(hi[key].rate)} for ${label(hi.cue)}; ${k === 0 ? 'no pair differs by more than chance' : `${k} of ${m} pairs differ clearly, but not these two`}.`);
		}
	};
	spreadLine('tooLate', 'too late');
	spreadLine('tooEarly', 'too early');
	if (thinNote) more.push(thinNote);
	return { ...base, groups, tone, headline, details, more };
}
