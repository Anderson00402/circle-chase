/**
 * Per-session totals ("cells") for the dashboard's headline numbers, and the pure arithmetic that
 * turns them into the page's results.
 *
 * Why: the headline query used to read every trial digest row of the filter (about 300 ms per
 * 8,000 power-ups, growing with every trial). The rates, intervals and paired comparisons only need
 * counts per person and condition, plus the turn-away times of decision trials, so each session
 * keeps those in a small document (`trialCells`, kept in step with its digest by
 * convex/lib/digest.ts). The headline query reads one small document per session.
 *
 * Every count is kept for both "too early" lines (`LINES`: the rules' 2 s and the 2.5 s check),
 * worked out with the shared classifier from the raw measures each digest row carries, so the line
 * switch never changes a stored outcome.
 *
 * Pure (no Convex imports), so tests can check it against the row-by-row arithmetic and time it on
 * a synthetic load (cells.test.ts).
 */
import { BOOT_MIN_PARTICIPANTS, BOOT_RESAMPLES, quantile, spread, wilson, type Cluster, type IntervalMethod, type Rate } from './stats';
import { classify, DECISIONS, isLateCatch, PURSUIT_GAIN, REACH_SPEED, RULES_VERSION, TIMELY, TIMELY_CHECK, type ChaseEnd, type RuleInput } from './rules';
import {
	againstRef, allPairs, family, median, PAIR_MIN_PEOPLE, paired as pairedOf, pairedFrom, peopleNeeded, pooledSd, RATE_INDEX, unpairedFrom,
	type Adjusted, type Cells, type Paired, type RateKey
} from './compare';

// ---------- lines ----------

/** The "too early" lines the page can show: the rules' own (index 0, the default) and the check. */
export const LINES = [TIMELY[1], TIMELY_CHECK] as const;
/** Index into `LINES` for a line in seconds (anything but the check line is the default). */
export const lineIndex = (line?: number | null): number => (line === TIMELY_CHECK ? 1 : 0);

/** Conditions with fewer decision trials are not ranked or compared (docs/STUDY.md). */
export const ENOUGH = 10;
/** ...nor with decision trials from fewer people than this (no paired test can run below it). */
export const RANK_PEOPLE = PAIR_MIN_PEOPLE;

// ---------- one row ----------

/** The fields of a digest row the cells need (convex/lib/digest.ts `digestRow`). */
export interface CellRow {
	id: string;
	cue: string;
	createdAt: number;
	outcome: string;
	rulesVersion: number | null;
	engaged: boolean;
	inRates: boolean;
	practice: boolean;
	turnLeft: number | null;
	wasted: number | null;
	total: number;
	trialIndex: number;
	blockIndex: number;
	sound: boolean;
	inputType: string;
	fps: number;
	clip: boolean;
	caught: boolean;
	nearMiss: boolean;
	gaveUpEarly?: boolean;
	mode?: 'study' | 'arcade';
	// Raw measures the rules read (absent on digests built before they were carried).
	endReason?: string;
	lastChaseEnd?: ChaseEnd | null;
	turnDist?: number | null;
	chaseEndDist?: number | null;
	endDist?: number | null;
	cut?: 'power' | 'clear' | 'quit' | null;
}

/** The rules' input rebuilt from a digest row; null when the row does not carry the raw measures. */
export function ruleInput(r: CellRow): RuleInput | null {
	if (r.endReason === undefined || r.lastChaseEnd === undefined || r.chaseEndDist === undefined) return null;
	return {
		endReason: r.endReason, engaged: r.engaged, after: { caught: r.caught, cut: r.cut ?? null }, endDist: r.endDist ?? null,
		lastChaseEnd: r.lastChaseEnd, turnLeft: r.turnLeft, turnDist: r.turnDist ?? null, chaseEndDist: r.chaseEndDist
	};
}

/**
 * The row's outcome with the "too early" line at `LINES[li]`. The rules' own line is the stored
 * outcome. The check line asks the shared classifier again from the stored raw measures; rows
 * classified by older rules keep their class (they are in no rate anyway). A row without its raw
 * measures falls back to the one thing the line changes: a retreat with more than the line left is
 * too early, otherwise in time (the same answer, since reachability does not depend on the line).
 */
export function outcomeAt(r: CellRow, li: number): string {
	if (li === 0 || r.rulesVersion !== RULES_VERSION) return r.outcome;
	const m = ruleInput(r);
	if (m) return classify(m, { timely: LINES[li] });
	if ((r.outcome === 'timely-retreat' || r.outcome === 'early-retreat') && r.turnLeft !== null) {
		return r.turnLeft <= LINES[li] ? 'timely-retreat' : 'early-retreat';
	}
	return r.outcome;
}

const DECISION_SET = new Set<string>(DECISIONS);
/** Counts toward the rates (the set does not depend on the line: both retreats are decisions). */
export const isDecisionRow = (r: Pick<CellRow, 'outcome' | 'inRates' | 'rulesVersion'>) =>
	r.rulesVersion === RULES_VERSION && r.inRates && DECISION_SET.has(r.outcome);

/**
 * Time to spare at a turn-away: the power left minus the time the pursuit still needed to reach
 * the ghost (distance / closing speed). Positive: the player still had time for it; negative: the
 * chase could not have succeeded. Study rules: scared ghosts flee and the pursuit closes at
 * `PURSUIT_GAIN`; arcade rules: the ghost is taken to hold still (`REACH_SPEED`). Null when the row
 * is not a retreat or lacks the distance.
 */
export function timeToSpare(r: Pick<CellRow, 'turnLeft' | 'turnDist' | 'mode'>, outcome: string): number | null {
	if (outcome !== 'timely-retreat' && outcome !== 'early-retreat') return null;
	if (r.turnLeft === null || r.turnDist === null || r.turnDist === undefined) return null;
	const gain = r.mode === 'arcade' ? REACH_SPEED : PURSUIT_GAIN;
	return Math.round((r.turnLeft - r.turnDist / gain) * 100) / 100;
}

// ---------- counts ----------

/**
 * Decision counts under both lines: [n, too late, caught, in time (2 s), too early (2 s), in time
 * (2.5 s), too early (2.5 s)]. n, too late and caught do not depend on the line.
 */
export type Counts = number[];
const zero = (): Counts => [0, 0, 0, 0, 0, 0, 0];
function addTo(c: Counts, d: Counts) {
	for (let i = 0; i < 7; i++) c[i] += d[i];
}
/** n and the four rate numerators [in time, too late, caught, too early] (compare.ts order) at line li. */
export function hitsAt(c: Counts, li: number): { n: number; k: [number, number, number, number] } {
	return { n: c[0], k: [c[3 + 2 * li], c[1], c[2], c[4 + 2 * li]] };
}

/** Everything the headline needs about one condition in one session (or merged over several). */
export interface CueAgg {
	/** Trials, engaged, eligible (current rules, in the rates' pool), recorded under older rules, and eligible among those. */
	t: number;
	eng: number;
	elig: number;
	old: number;
	oldElig: number;
	/** Near misses. */
	nm: number;
	/** Every trial by stored outcome. */
	out: Record<string, number>;
	/** Trials that are "too early" on the rules' line but "in time" on the check line. */
	sh: number;
	/** Decision counts. */
	d: Counts;
	/** Recorded but not counted, by reason. */
	nc: Record<string, number>;
	/** Catches among eligible trials, and the late ones. */
	cat: number;
	lcat: number;
	/** Decision trials that gave up very early and are too early (not caught), and decision trials carrying that flag. */
	gu: number;
	guf: number;
	/** Decision trials whose 3 s aftermath was cut short by a maze clear (kept in the rates; absent on older totals). */
	cc?: number;
	/** Turn-away time of every decision trial that turned (2 decimals). */
	turn: number[];
	/** Wasted power of every early retreat (rules' line). */
	waste: number[];
	/** Decision counts by power-up number within the run (1-8, 8 = 8 and later) and by run position. */
	bt: Record<string, Counts>;
	bb: Record<string, Counts>;
	/** Highest run position seen (any trial). */
	mb: number;
	/** Decision counts by breakdown level, keyed "factor|level". */
	bd: Record<string, Counts>;
}

export function emptyAgg(): CueAgg {
	return { t: 0, eng: 0, elig: 0, old: 0, oldElig: 0, nm: 0, out: {}, sh: 0, d: zero(), nc: {}, cat: 0, lcat: 0, gu: 0, guf: 0, turn: [], waste: [], bt: {}, bb: {}, mb: 0, bd: {} };
}

const addMap = (m: Record<string, number>, k: string, v = 1) => (m[k] = (m[k] ?? 0) + v);
function addCounts(m: Record<string, Counts>, k: string, d: Counts) {
	addTo((m[k] ??= zero()), d);
}

/** Learning curves are cut at this many trials in a block; later trials are pooled into the last bucket. */
export const MAX_TRIAL_BUCKET = 8;
/** Run positions beyond this are not drawn. */
const MAX_BLOCK = 13;

/**
 * Breakdowns ("Does it depend on how it was played?"): each factor's levels in reading order. The
 * difference shown is the second level minus the first (later minus earlier, long minus short,
 * sound on minus off); input levels are ordered by how often they occur.
 */
export const FACTORS = {
	half: { of: (r: CellRow) => (r.mode !== 'study' ? null : r.blockIndex < 6 ? 'Blocks 1-6' : 'Blocks 7-13'), levels: ['Blocks 1-6', 'Blocks 7-13'] },
	power: { of: (r: CellRow) => (r.total < 6 ? 'Under 6 s' : '6 s or more'), levels: ['Under 6 s', '6 s or more'] },
	sound: { of: (r: CellRow) => (r.sound ? 'Sound on' : 'Sound off'), levels: ['Sound off', 'Sound on'] },
	input: { of: (r: CellRow) => r.inputType || 'unknown', levels: [] as string[] }
} as const;
export type FactorKey = keyof typeof FACTORS;
export const FACTOR_KEYS = Object.keys(FACTORS) as FactorKey[];

/** Add one row to a condition's totals. */
export function addRow(a: CueAgg, r: CellRow) {
	const v3 = r.rulesVersion === RULES_VERSION;
	a.t++;
	if (r.engaged) a.eng++;
	if (v3 && r.inRates) a.elig++;
	if (!v3) {
		a.old++;
		if (r.inRates) a.oldElig++;
	}
	if (r.nearMiss) a.nm++;
	addMap(a.out, r.outcome);
	const alt = outcomeAt(r, 1);
	if (r.outcome === 'early-retreat' && alt === 'timely-retreat') a.sh++;
	if (v3 && r.inRates && r.outcome === 'catch') {
		a.cat++;
		if (isLateCatch(r)) a.lcat++;
	}
	if (r.outcome === 'early-retreat' && r.wasted !== null) a.waste.push(Math.round(r.wasted * 100) / 100);
	a.mb = Math.max(a.mb, r.blockIndex + 1);
	if (!isDecisionRow(r)) {
		const why = !v3 ? 'old-rules' : DECISION_SET.has(r.outcome) ? 'left-early' : r.outcome;
		addMap(a.nc, why);
		return;
	}
	const o = [r.outcome, alt];
	const d: Counts = [
		1,
		r.outcome === 'caught' || r.outcome === 'overstayed' ? 1 : 0,
		r.outcome === 'caught' ? 1 : 0,
		o[0] === 'timely-retreat' ? 1 : 0,
		o[0] === 'early-retreat' ? 1 : 0,
		o[1] === 'timely-retreat' ? 1 : 0,
		o[1] === 'early-retreat' ? 1 : 0
	];
	addTo(a.d, d);
	if (r.cut === 'clear') a.cc = (a.cc ?? 0) + 1;
	if (r.gaveUpEarly !== undefined) {
		a.guf++;
		// "Gave up very early" is a part of too early. A trial that gave up early and was then caught
		// is classed "caught" (caught has priority, docs/STUDY.md), so it counts there only, once.
		if (r.gaveUpEarly && r.outcome === 'early-retreat') a.gu++;
	}
	if (r.turnLeft !== null) a.turn.push(Math.round(r.turnLeft * 100) / 100);
	addCounts(a.bt, String(Math.min(r.trialIndex + 1, MAX_TRIAL_BUCKET)), d);
	if (r.blockIndex + 1 <= MAX_BLOCK) addCounts(a.bb, String(r.blockIndex + 1), d);
	for (const f of FACTOR_KEYS) {
		const lv = FACTORS[f].of(r);
		if (lv !== null) addCounts(a.bd, `${f}|${lv}`, d);
	}
}

/** b merged into a (in place). `core`: only what a summary reads (not the learning and breakdown counts). */
export function mergeAgg(a: CueAgg, b: CueAgg, core = false): CueAgg {
	a.t += b.t; a.eng += b.eng; a.elig += b.elig; a.old += b.old; a.oldElig += b.oldElig; a.nm += b.nm;
	for (const k in b.out) addMap(a.out, k, b.out[k]);
	a.sh += b.sh;
	addTo(a.d, b.d);
	for (const k in b.nc) addMap(a.nc, k, b.nc[k]);
	a.cat += b.cat; a.lcat += b.lcat; a.gu += b.gu; a.guf += b.guf;
	if (b.cc) a.cc = (a.cc ?? 0) + b.cc;
	for (const x of b.turn) a.turn.push(x);
	for (const x of b.waste) a.waste.push(x);
	if (core) return a;
	for (const [k, v] of Object.entries(b.bt)) addCounts(a.bt, k, v);
	for (const [k, v] of Object.entries(b.bb)) addCounts(a.bb, k, v);
	a.mb = Math.max(a.mb, b.mb);
	for (const [k, v] of Object.entries(b.bd)) addCounts(a.bd, k, v);
	return a;
}

// ---------- one session ----------

/** A group of a session's rows that filters treat alike (rules mode, warm-up or not). */
export interface CellGroup {
	mode: 'study' | 'arcade';
	practice: boolean;
	firstAt: number;
	lastAt: number;
	cues: Record<string, CueAgg>;
}

/** Session columns for the sessions table (warm-up trials left out). */
export interface SessionSum {
	t: number;
	eng: number;
	dec: number;
	clips: number;
	firstClip: string | null;
	fpsSum: number;
	fpsN: number;
	fpsMin: number | null;
	low: number;
	blocks: number;
}

export interface CellsData {
	groups: CellGroup[];
	session: SessionSum;
}

/** The cells of one session's rows (`mode`: the session's, for rows that carry none). */
export function cellsOfRows(rows: CellRow[], mode: 'study' | 'arcade'): CellsData {
	const groups = new Map<string, CellGroup>();
	const s: SessionSum = { t: 0, eng: 0, dec: 0, clips: 0, firstClip: null, fpsSum: 0, fpsN: 0, fpsMin: null, low: 0, blocks: 0 };
	const blocks = new Set<number>();
	for (const r0 of rows) {
		const r = r0.mode ? r0 : { ...r0, mode };
		const key = `${r.mode}|${r.practice ? 1 : 0}`;
		let g = groups.get(key);
		if (!g) groups.set(key, (g = { mode: r.mode!, practice: r.practice, firstAt: r.createdAt, lastAt: r.createdAt, cues: {} }));
		g.firstAt = Math.min(g.firstAt, r.createdAt);
		g.lastAt = Math.max(g.lastAt, r.createdAt);
		addRow((g.cues[r.cue] ??= emptyAgg()), r);
		if (r.practice) continue;
		s.t++;
		if (r.engaged) s.eng++;
		if (isDecisionRow(r)) s.dec++;
		if (r.clip) {
			s.clips++;
			s.firstClip ??= r.id;
		}
		if (r.fps > 0) {
			s.fpsSum += r.fps;
			s.fpsN++;
			s.fpsMin = s.fpsMin === null ? r.fps : Math.min(s.fpsMin, r.fps);
			if (r.fps < 50) s.low++;
		}
		blocks.add(r.blockIndex);
	}
	s.blocks = blocks.size;
	return { groups: [...groups.values()], session: s };
}

// ---------- intervals ----------

/** The seed hash of convex/lib/stats.ts (its generator is inlined below), so the intervals are the same numbers. */
function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

/**
 * The participant-clustered bootstrap of convex/lib/stats.ts `clusteredRates` for the four rates,
 * giving the same numbers (same seed, same draws, same percentiles; cells.test.ts checks it) but
 * on typed arrays, about three times faster: the headline runs one per condition, and with a few
 * hundred people that was most of its time.
 */
export function clusteredRates4(clusters: Cluster[], seedKey: string, resamples = BOOT_RESAMPLES): { method: IntervalMethod; rates: Rate[] } {
	const live = clusters.filter((c) => c.n > 0);
	const n = live.reduce((a, c) => a + c.n, 0);
	const k = [0, 1, 2, 3].map((j) => live.reduce((a, c) => a + c.k[j], 0));
	if (live.length < BOOT_MIN_PARTICIPANTS) return { method: 'wilson', rates: k.map((kj) => ({ ...wilson(kj, n), method: 'wilson' as const })) };
	// mulberry32, as `rng` above, inlined: the closure call was most of the cost.
	let st = hash(`${seedKey}|${n}|${k.join(',')}|${live.length}`) >>> 0;
	const P = live.length;
	const N = new Float64Array(P), K = new Float64Array(P * 4);
	live.forEach((c, i) => {
		N[i] = c.n;
		for (let j = 0; j < 4; j++) K[i * 4 + j] = c.k[j];
	});
	const d0 = new Float64Array(resamples), d1 = new Float64Array(resamples), d2 = new Float64Array(resamples), d3 = new Float64Array(resamples);
	for (let b = 0; b < resamples; b++) {
		let nb = 0, s0 = 0, s1 = 0, s2 = 0, s3 = 0;
		for (let i = 0; i < P; i++) {
			st = (st + 0x6d2b79f5) >>> 0;
			let t = st;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			const x = Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * P), o = x * 4;
			nb += N[x];
			s0 += K[o];
			s1 += K[o + 1];
			s2 += K[o + 2];
			s3 += K[o + 3];
		}
		d0[b] = s0 / nb;
		d1[b] = s1 / nb;
		d2[b] = s2 / nb;
		d3[b] = s3 / nb;
	}
	const draws = [d0, d1, d2, d3];
	return {
		method: 'bootstrap',
		rates: k.map((kj, j) => {
			if (kj === 0 || kj === n) return { ...wilson(kj, n), method: 'wilson' as const };
			const sorted = draws[j].sort() as unknown as number[];
			return { k: kj, n, rate: kj / n, lo: quantile(sorted, 0.025), hi: quantile(sorted, 0.975), method: 'bootstrap' as const };
		})
	};
}

/** Every cluster pooled into one (so the interval falls back to Wilson). */
function mergeClusters(cs: Cluster[]): Cluster {
	return { n: cs.reduce((a, c) => a + c.n, 0), k: [0, 1, 2, 3].map((j) => cs.reduce((a, c) => a + c.k[j], 0)) };
}

// ---------- the headline, from cells ----------

/** One session's contribution to a filter: its participant and its conditions' totals. */
export interface Part {
	pid: string;
	sid: string;
	firstAt: number;
	lastAt: number;
	cues: Record<string, CueAgg>;
}

const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10000) / 10000);
/** A comparison as the page needs it (fractions rounded; p-values kept). */
export function slim(x: Adjusted & { between?: boolean }) {
	return {
		a: x.a, b: x.b, people: x.people, diff: r4(x.diff), lo: r4(x.lo), hi: r4(x.hi), sd: r4(x.sd), p: x.p, pAdj: x.pAdj, clear: x.clear,
		...(x.between ? { between: true } : {})
	};
}
export type Comparison = ReturnType<typeof slim>;

/** Rates over a group of decision trials (learning curves; Wilson intervals, all conditions pooled). */
export interface Bucket {
	x: number;
	n: number;
	wellTimed: Rate;
	tooLate: Rate;
	tooEarly: Rate;
	caught: Rate;
}
function bucketOf(x: number, c: Counts, li: number): Bucket {
	const { n, k } = hitsAt(c, li);
	const w = (j: number) => ({ ...wilson(k[j], n), method: 'wilson' as const });
	return { x, n, wellTimed: w(0), tooLate: w(1), tooEarly: w(3), caught: w(2) };
}

/**
 * A condition's summary (the shape of convex/lib/stats.ts `summarize`, without per-trial lists).
 * `boot: false` gives Wilson intervals (the pooled "all conditions" summary, which no chart draws).
 */
export function summaryOf(cue: string, perP: [string, CueAgg][], li: number, boot = true) {
	const tot = emptyAgg();
	for (const [, a] of perP) mergeAgg(tot, a, true);
	// Clusters in participant order, so the interval does not depend on the order rows were read in.
	const sorted = [...perP].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
	const clusters: Cluster[] = sorted.map(([, a]) => hitsAt(a.d, li)).map(({ n, k }) => ({ n, k }));
	const r = clusteredRates4(boot ? clusters : [mergeClusters(clusters)], cue);
	const { n: decisions, k } = hitsAt(tot.d, li);
	const outcomes = { ...tot.out };
	if (li > 0 && tot.sh) {
		outcomes['early-retreat'] = (outcomes['early-retreat'] ?? 0) - tot.sh;
		outcomes['timely-retreat'] = (outcomes['timely-retreat'] ?? 0) + tot.sh;
		if (!outcomes['early-retreat']) delete outcomes['early-retreat'];
	}
	const countedOutcomes: Record<string, number> = {};
	const put = (o: string, x: number) => x && (countedOutcomes[o] = x);
	put('caught', k[2]);
	put('overstayed', k[1] - k[2]);
	put('timely-retreat', k[0]);
	put('early-retreat', k[3]);
	const turn = spread(tot.turn);
	const waste = spread(li > 0 ? tot.waste.filter((v) => v > LINES[li]) : tot.waste);
	return {
		cue,
		trials: tot.t,
		engaged: tot.eng,
		inRates: tot.elig,
		decisions,
		participants: perP.filter(([, a]) => a.t > 0).length,
		decisionParticipants: clusters.filter((c) => c.n > 0).length,
		outcomes,
		wellTimed: r.rates[0],
		tooLate: r.rates[1],
		caught: r.rates[2],
		tooEarly: r.rates[3],
		interval: r.method,
		leftOut: { oldRules: tot.oldElig },
		catches: { n: tot.cat, late: tot.lcat, share: tot.elig ? tot.cat / tot.elig : null },
		turnAway: { ...turn, values: [] as number[] },
		wasted: { ...waste, values: [] as number[] },
		nearMisses: tot.nm,
		oldRules: tot.old,
		clarity: { n: 0, mean: null as number | null },
		distraction: { n: 0, mean: null as number | null },
		notEnoughData: decisions < ENOUGH,
		countedOutcomes,
		gaveUpEarly: tot.guf ? { k: tot.gu, n: decisions } : null
	};
}
export type CueSummary = ReturnType<typeof summaryOf>;

/** Ranked: enough decision trials, from enough people. */
export const isRanked = (s: { decisions: number; decisionParticipants: number }) => s.decisions >= ENOUGH && s.decisionParticipants >= RANK_PEOPLE;

const COMPARED: RateKey[] = ['wellTimed', 'tooLate', 'tooEarly'];
/** The yardsticks every condition is compared with (each its own family of comparisons). */
export const YARDSTICK_IDS = ['timer-bar', 'none', 'classic-blink'] as const;
/** Smallest paired difference worth detecting (fraction) in the precision statement. */
export const TARGET_DIFF = 0.15;

/**
 * Participant -> condition -> merged totals. The parts are this call's own (parsed for it), so a
 * person's first session is used as it is and later sessions are merged into it.
 */
function byPerson(parts: Part[]): Map<string, Map<string, CueAgg>> {
	const m = new Map<string, Map<string, CueAgg>>();
	for (const p of parts) {
		let byCue = m.get(p.pid);
		if (!byCue) m.set(p.pid, (byCue = new Map()));
		for (const [cue, a] of Object.entries(p.cues)) {
			const have = byCue.get(cue);
			if (have) mergeAgg(have, a);
			else byCue.set(cue, a);
		}
	}
	return m;
}

/** Paired decision cells (compare.ts) at line li. */
function cellsAt(people: Map<string, Map<string, CueAgg>>, li: number): Cells {
	const cells: Cells = new Map();
	for (const [pid, byCue] of people) {
		const m = new Map<string, { n: number; k: [number, number, number, number] }>();
		for (const [cue, a] of byCue) if (a.d[0] > 0) m.set(cue, hitsAt(a.d, li));
		if (m.size) cells.set(pid, m);
	}
	return cells;
}

/**
 * Difference between two levels of a factor, for one condition (or pooled over all), as the second
 * level minus the first. Inside each person when at least 5 people have decision trials at both
 * levels (power length, and block position pooled over conditions); otherwise between people
 * (Welch on one rate per person), and marked so: a person plays a condition in one block only, and
 * sound and input usually stay the same for a person.
 */
function factorDiffs(people: Map<string, Map<string, CueAgg>>, f: FactorKey, levels: [string, string], cues: string[], li: number) {
	type H = { n: number; k: number[] } | null;
	const keys = [`${f}|${levels[0]}`, `${f}|${levels[1]}`];
	// Per person, once: hits at each level, per condition and pooled over conditions.
	const per = [...people.values()].map((bc) => {
		const byCue = new Map<string, [H, H]>();
		const pool: [{ n: number; k: number[] }, { n: number; k: number[] }] = [{ n: 0, k: [0, 0, 0, 0] }, { n: 0, k: [0, 0, 0, 0] }];
		for (const [c, a] of bc) {
			const h = keys.map((key) => (a.bd[key] ? hitsAt(a.bd[key], li) : null)) as [H, H];
			byCue.set(c, h);
			h.forEach((x, l) => {
				if (!x) return;
				pool[l].n += x.n;
				for (let j = 0; j < 4; j++) pool[l].k[j] += x.k[j];
			});
		}
		return { byCue, pool: pool.map((x) => (x.n ? x : null)) as [H, H] };
	});
	const one = (get: (p: (typeof per)[number]) => [H, H] | undefined, j: number, id: string): Paired & { between: boolean } => {
		const ds: number[] = [], xa: number[] = [], xb: number[] = [];
		for (const p of per) {
			const h = get(p);
			if (!h) continue;
			const [y, x] = h;
			if (x && y) ds.push(x.k[j] / x.n - y.k[j] / y.n);
			if (x) xa.push(x.k[j] / x.n);
			if (y) xb.push(y.k[j] / y.n);
		}
		if (ds.length >= PAIR_MIN_PEOPLE) return { ...pairedFrom(ds, id, id), between: false };
		return { ...unpairedFrom(xa, xb, id, id), between: true };
	};
	const out = {} as Record<RateKey, { all: Comparison; cues: Comparison[] }>;
	let between = false;
	for (const key of COMPARED) {
		const j = RATE_INDEX[key];
		const a1 = one((p) => p.pool, j, 'all');
		const all = { ...family([a1])[0], between: a1.between };
		const list = cues.map((c) => one((p) => p.byCue.get(c), j, c));
		const fam = family(list).map((x, i) => ({ ...x, between: list[i].between }));
		between ||= a1.between;
		out[key] = { all: slim(all), cues: fam.map(slim) };
	}
	return { between, diffs: out };
}

/**
 * Everything the top of the dashboard needs for one filter, from the cells of its sessions, with
 * the "too early" line at `LINES[li]`: totals, per-condition summaries, within-person comparisons
 * (every condition against each yardstick, every pair of ranked conditions, turn-away times), how
 * precise this is, breakdowns as within-person differences, and learning over trials and blocks.
 */
export function mainOf(parts: Part[], li: number) {
	const people = byPerson(parts);
	const cueSet = new Set<string>();
	for (const p of parts) for (const c of Object.keys(p.cues)) cueSet.add(c);
	const cues = [...cueSet].sort();
	const perCue = (c: string) => [...people.entries()].filter(([, bc]) => bc.has(c)).map(([pid, bc]) => [pid, bc.get(c)!] as [string, CueAgg]);
	const byCue = cues.map((c) => summaryOf(c, perCue(c), li));
	const allPer = [...people.entries()].map(([pid, bc]) => [pid, [...bc.values()].reduce((m, a) => mergeAgg(m, a, true), emptyAgg())] as [string, CueAgg]);
	const all = summaryOf('all', allPer, li, false);

	// Within-person comparisons on decision trials.
	const cells = cellsAt(people, li);
	const ranked = byCue.filter(isRanked).map((c) => c.cue);
	const versus = (ref: string) => Object.fromEntries(COMPARED.map((k) => [k, againstRef(cells, cues, ref, RATE_INDEX[k]).map(slim)])) as Record<RateKey, Comparison[]>;
	const paired = Object.fromEntries(YARDSTICK_IDS.map((y) => [y, versus(y)])) as Record<(typeof YARDSTICK_IDS)[number], Record<RateKey, Comparison[]>>;
	const pairs = Object.fromEntries(COMPARED.map((k) => [k, allPairs(cells, ranked, RATE_INDEX[k]).map(slim)])) as Record<RateKey, Comparison[]>;

	// Turn-away time compared within people: each person's median under the condition minus under
	// the timer bar (seconds; positive: turned away with more time left).
	const medTurn = new Map<string, Map<string, number>>();
	for (const [pid, bc] of people) {
		const m = new Map<string, number>();
		for (const [c, a] of bc) if (a.turn.length) m.set(c, median(a.turn)!);
		medTurn.set(pid, m);
	}
	const turnVsTimer = family(cues.filter((c) => c !== 'timer-bar').map((c) => {
		const ds: number[] = [];
		for (const m of medTurn.values()) if (m.has(c) && m.has('timer-bar')) ds.push(m.get(c)! - m.get('timer-bar')!);
		return pairedFrom(ds, c, 'timer-bar', Infinity);
	})).map(slim);

	// How precise: decision trials per person and condition, interval width, people needed.
	const perCell: number[] = [];
	for (const byC of cells.values()) for (const c of byC.values()) perCell.push(c.n);
	const vsTimer = againstRef(cells, cues, 'timer-bar', RATE_INDEX.wellTimed);
	const halfWidths = vsTimer.filter((x) => x.lo !== null && x.hi !== null).map((x) => (x.hi! - x.lo!) / 2);
	const sd = pooledSd(vsTimer);
	const comparisons = Math.max(1, vsTimer.length || 12);
	// What it would take to order the top two: people needed at their observed gap and spread, for
	// the strictest step of Holm over every pair.
	const top2 = byCue.filter(isRanked).sort((a, b) => (b.wellTimed.rate ?? 0) - (a.wellTimed.rate ?? 0)).slice(0, 2);
	const topPair = top2.length === 2 ? pairedOf(cells, top2[0].cue, top2[1].cue, RATE_INDEX.wellTimed) : null;
	const nPairs = Math.max(1, (ranked.length * (ranked.length - 1)) / 2);
	const precision = {
		people: cells.size,
		perPersonCondition: median(perCell),
		halfWidth: r4(median(halfWidths)),
		sd: r4(sd),
		target: TARGET_DIFF,
		comparisons,
		needed: sd !== null && sd > 0 ? peopleNeeded(sd, TARGET_DIFF, 0.05 / comparisons) : null,
		neededSingle: sd !== null && sd > 0 ? peopleNeeded(sd, TARGET_DIFF, 0.05) : null,
		top: topPair && topPair.sd && topPair.diff
			? { a: topPair.a, b: topPair.b, gap: r4(topPair.diff), people: topPair.people, needed: peopleNeeded(topPair.sd, Math.abs(topPair.diff), 0.05 / nPairs) }
			: null
	};

	// Breakdowns: counts per condition and level, and the within-person difference between the levels.
	const breakdowns = {} as Record<FactorKey, { levels: string[]; compared: [string, string] | null; between: boolean; counts: Record<string, Record<string, [number, number, number, number]>>; diffs: Record<RateKey, { all: Comparison; cues: Comparison[] }> | null }>;
	for (const f of FACTOR_KEYS) {
		const counts: Record<string, Record<string, [number, number, number, number]>> = {};
		const seen = new Map<string, number>();
		for (const [, bc] of people) for (const [c, a] of bc) for (const [key, cnt] of Object.entries(a.bd)) {
			const [fk, lv] = key.split('|');
			if (fk !== f) continue;
			const { n, k } = hitsAt(cnt, li);
			seen.set(lv, (seen.get(lv) ?? 0) + n);
			for (const id of [c, 'all']) {
				const cell = ((counts[id] ??= {})[lv] ??= [0, 0, 0, 0]);
				cell[0] += n;
				cell[1] += k[0];
				cell[2] += k[1];
				cell[3] += k[3];
			}
		}
		const fixed = FACTORS[f].levels as readonly string[];
		const levels = fixed.length
			? fixed.filter((lv) => seen.has(lv))
			: [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([lv]) => lv);
		const compared = levels.length >= 2 ? ([levels[0], levels[1]] as [string, string]) : null;
		const fd = compared ? factorDiffs(people, f, compared, cues, li) : null;
		breakdowns[f] = { levels, compared, between: fd?.between ?? false, counts, diffs: fd?.diffs ?? null };
	}

	// Learning: trial number within the block (last bucket pooled) and block position.
	const bt = new Map<number, Counts>(), bb = new Map<number, Counts>();
	let maxBlock = 0;
	for (const [, bc] of people) for (const a of bc.values()) {
		maxBlock = Math.max(maxBlock, a.mb);
		for (const [k, c] of Object.entries(a.bt)) addTo(bt.get(+k) ?? (bt.set(+k, zero()), bt.get(+k)!), c);
		for (const [k, c] of Object.entries(a.bb)) addTo(bb.get(+k) ?? (bb.set(+k, zero()), bb.get(+k)!), c);
	}
	const byTrial: Bucket[] = [];
	for (let i = 1; i <= MAX_TRIAL_BUCKET; i++) byTrial.push(bucketOf(i, bt.get(i) ?? zero(), li));
	const byBlock: Bucket[] = [];
	for (let b = 1; b <= Math.min(maxBlock, MAX_BLOCK); b++) byBlock.push(bucketOf(b, bb.get(b) ?? zero(), li));

	const allAgg = allPer.reduce((m, [, a]) => mergeAgg(m, a, true), emptyAgg());
	const firstAt = parts.length ? Math.min(...parts.map((p) => p.firstAt)) : null;
	const lastAt = parts.length ? Math.max(...parts.map((p) => p.lastAt)) : null;
	return {
		line: LINES[li],
		totals: {
			trials: allAgg.t,
			engaged: allAgg.eng,
			inRates: allAgg.elig,
			decisions: allAgg.d[0],
			oldRules: allAgg.old,
			notCounted: allAgg.nc,
			/** Counted power-ups whose aftermath a maze clear cut short (they stay in the rates). */
			cutByClear: allAgg.cc ?? 0,
			participants: [...people.values()].filter((bc) => [...bc.values()].some((a) => a.t > 0)).length,
			sessions: new Set(parts.filter((p) => Object.values(p.cues).some((a) => a.t > 0)).map((p) => p.sid)).size,
			firstAt,
			lastAt
		},
		all,
		cues: byCue,
		ranked,
		paired,
		pairs,
		turnVsTimer,
		precision,
		breakdowns,
		learning: { byTrial, byBlock, maxTrialBucket: MAX_TRIAL_BUCKET }
	};
}
export type MainResult = ReturnType<typeof mainOf>;
