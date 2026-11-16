/**
 * Numbers for the dashboard, computed from plain trial rows. Pure, so the browser can reuse it and
 * tests can check it. Definitions follow docs/STUDY.md "Headline numbers per cue" and the outcome
 * rules in ./rules.ts.
 *
 * Rates divide by decision trials (caught + overstayed + timely retreat + early retreat): the
 * trials whose ending shows whether the player knew the time left. Catches show no decision and are
 * reported apart. Intervals are clustered by participant (a bootstrap over participants), because
 * the power-ups of one person are not independent; below 3 participants they fall back to Wilson.
 */
import { RULES_VERSION, isCountedEngaged, isDecision, isLateCatch } from './rules';

export type IntervalMethod = 'bootstrap' | 'wilson';

export interface Rate {
	/** Trials that count (k) out of n. */
	k: number;
	n: number;
	/** k / n, or null when n = 0. */
	rate: number | null;
	/** 95% interval; null when n = 0. */
	lo: number | null;
	hi: number | null;
	/** How the interval was computed (absent on plain Wilson rates). */
	method?: IntervalMethod;
}

/** Wilson score interval for k successes in n trials (z = 1.96 for 95%). */
export function wilson(k: number, n: number, z = 1.96): Rate {
	if (n <= 0) return { k, n, rate: null, lo: null, hi: null };
	const p = k / n, z2 = z * z;
	const den = 1 + z2 / n;
	const mid = (p + z2 / (2 * n)) / den;
	const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
	return { k, n, rate: p, lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

/** Linear-interpolated quantile of an ascending array (same as R type 7 / numpy default). */
export function quantile(sorted: number[], p: number): number | null {
	if (!sorted.length) return null;
	const h = (sorted.length - 1) * p;
	const lo = Math.floor(h), hi = Math.ceil(h);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

export interface Spread {
	n: number;
	q10: number | null;
	q25: number | null;
	median: number | null;
	q75: number | null;
	q90: number | null;
	mean: number | null;
	/** Every value, for strip plots. */
	values: number[];
}

export function spread(values: number[]): Spread {
	const s = [...values].sort((a, b) => a - b);
	const r = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);
	return {
		n: s.length,
		q10: r(quantile(s, 0.1)), q25: r(quantile(s, 0.25)), median: r(quantile(s, 0.5)),
		q75: r(quantile(s, 0.75)), q90: r(quantile(s, 0.9)),
		mean: s.length ? r(s.reduce((a, b) => a + b, 0) / s.length) : null,
		values: s
	};
}

// ---------- participant-clustered bootstrap ----------

export const BOOT_RESAMPLES = 2000;
/** Fewer participants than this: Wilson instead of the bootstrap. */
export const BOOT_MIN_PARTICIPANTS = 3;

/** Small seeded generator (mulberry32), so an interval is the same every time for the same data. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

/** One participant's decision trials: n, and k for each rate. */
export interface Cluster {
	n: number;
	k: number[];
}

/**
 * Rates with 95% intervals for several numerators over the same decision trials, clustered by
 * participant: resample participants with replacement, pool their trials, take the 2.5th and
 * 97.5th percentiles of the pooled rate. Wilson when there are fewer than 3 participants.
 */
export function clusteredRates(clusters: Cluster[], rates: number, seedKey: string, resamples = BOOT_RESAMPLES): { method: IntervalMethod; rates: Rate[] } {
	const live = clusters.filter((c) => c.n > 0);
	const n = live.reduce((a, c) => a + c.n, 0);
	const k = Array.from({ length: rates }, (_, j) => live.reduce((a, c) => a + c.k[j], 0));
	if (live.length < BOOT_MIN_PARTICIPANTS) {
		return { method: 'wilson', rates: k.map((kj) => ({ ...wilson(kj, n), method: 'wilson' as const })) };
	}
	const rand = rng(hash(`${seedKey}|${n}|${k.join(',')}|${live.length}`));
	const draws = Array.from({ length: rates }, () => new Float64Array(resamples));
	const P = live.length;
	const sum = new Array<number>(rates);
	for (let b = 0; b < resamples; b++) {
		let nb = 0;
		sum.fill(0);
		for (let i = 0; i < P; i++) {
			const c = live[Math.floor(rand() * P)];
			nb += c.n;
			for (let j = 0; j < rates; j++) sum[j] += c.k[j];
		}
		for (let j = 0; j < rates; j++) draws[j][b] = sum[j] / nb;
	}
	return {
		method: 'bootstrap',
		rates: k.map((kj, j) => {
			// No event at all (or only events): every resample gives the same rate and the percentile
			// interval collapses to a point, which would look certain. Wilson is honest there.
			if (kj === 0 || kj === n) return { ...wilson(kj, n), method: 'wilson' as const };
			const s = Array.from(draws[j]).sort((x, y) => x - y);
			return { k: kj, n, rate: kj / n, lo: quantile(s, 0.025), hi: quantile(s, 0.975), method: 'bootstrap' as const };
		})
	};
}

// ---------- per-condition summary ----------

/** The fields of a trial row the summary needs. */
export interface TrialRow {
	cue: string;
	participantId: string;
	outcome: string;
	engaged: boolean;
	inRates: boolean;
	rulesVersion?: number;
	lateCatch: boolean;
	turnLeft: number | null;
	wasted: number | null;
	eats: { left: number }[];
	after: { nearMiss: boolean; caught: boolean };
}

export interface RatingRow {
	cue?: string;
	clarity?: number;
	distraction?: number;
}

/** The four headline rates, all over the same decision trials. */
export interface DecisionRates {
	/** Turned away in time / decision trials. Higher is better: the headline. */
	wellTimed: Rate;
	/** (Caught + stayed too long) / decision trials. */
	tooLate: Rate;
	/** Caught / decision trials: the worst part of "too late". */
	caught: Rate;
	/** Turned away too early / decision trials. */
	tooEarly: Rate;
	/** Interval used for all four. */
	interval: IntervalMethod;
	/**
	 * Trials left out of the rates for a reason the page should say. `oldRules`: eligible trials
	 * (engaged, ran out by itself, player stayed) recorded before the current rules, which cannot be
	 * recomputed because a measure the rules need was not stored ("not counted: recorded before the
	 * current rules").
	 */
	leftOut: { oldRules: number };
}

const RATE_KEYS = ['wellTimed', 'tooLate', 'caught', 'tooEarly'] as const;

/** Which of the four rates a decision outcome adds to. */
function rateHits(outcome: string): number[] {
	return [
		outcome === 'timely-retreat' ? 1 : 0,
		outcome === 'caught' || outcome === 'overstayed' ? 1 : 0,
		outcome === 'caught' ? 1 : 0,
		outcome === 'early-retreat' ? 1 : 0
	];
}

/** Headline rates for decision trials, clustered by `participantId`; Wilson if `wilsonOnly`. */
export function decisionRates(trials: { participantId: string; outcome: string; inRates: boolean; rulesVersion?: number }[], seedKey: string, wilsonOnly = false): DecisionRates {
	const byP = new Map<string, Cluster>();
	for (const t of trials) {
		if (!isDecision(t)) continue;
		let c = byP.get(t.participantId);
		if (!c) byP.set(t.participantId, (c = { n: 0, k: [0, 0, 0, 0] }));
		c.n++;
		rateHits(t.outcome).forEach((h, j) => (c.k[j] += h));
	}
	const clusters = [...byP.values()];
	const r = wilsonOnly
		? (() => {
			const n = clusters.reduce((a, c) => a + c.n, 0);
			return { method: 'wilson' as const, rates: [0, 1, 2, 3].map((j) => ({ ...wilson(clusters.reduce((a, c) => a + c.k[j], 0), n), method: 'wilson' as const })) };
		})()
		: clusteredRates(clusters, 4, seedKey);
	const oldRules = trials.filter((t) => t.inRates && t.rulesVersion !== RULES_VERSION).length;
	const out = { interval: r.method, leftOut: { oldRules } } as DecisionRates;
	RATE_KEYS.forEach((key, j) => (out[key] = r.rates[j]));
	return out;
}

export interface CueSummary extends DecisionRates {
	cue: string;
	trials: number;
	/** Engaged trials (any end, any rules version). */
	engaged: number;
	/** Engaged trials whose power ran out by itself and the player stayed (current rules): decisions plus catches and other. */
	inRates: number;
	/** Decision trials: caught + stayed too long + turned away in time + turned away too early. Every rate divides by this. */
	decisions: number;
	participants: number;
	/** Participants with at least one decision trial (the bootstrap resamples these). */
	decisionParticipants: number;
	/** All trials of the condition by outcome. */
	outcomes: Record<string, number>;
	/** Catches (the last chase ended by eating the ghost): no decision, so in no rate. */
	catches: { n: number; late: number; share: number | null };
	/** Turn-away time of decision trials, seconds of power left (negative after the end). */
	turnAway: Spread;
	/** Power left unused after an early retreat (all early retreats with a ghost still reachable). */
	wasted: Spread;
	nearMisses: number;
	/** Trials classified by older rules (no stored measure to recompute them), engaged or not: in no rate. `leftOut.oldRules` counts the eligible ones. */
	oldRules: number;
	clarity: { n: number; mean: number | null };
	distraction: { n: number; mean: number | null };
	/** Fewer than 10 decision trials. */
	notEnoughData: boolean;
}

export const ENOUGH = 10;

export function summarize(cue: string, trials: TrialRow[], ratings: RatingRow[], opts: { wilsonOnly?: boolean } = {}): CueSummary {
	const eligible = trials.filter(isCountedEngaged);
	const decisions = trials.filter(isDecision);
	const outcomes: Record<string, number> = {};
	for (const t of trials) outcomes[t.outcome] = (outcomes[t.outcome] ?? 0) + 1;
	const catches = eligible.filter((t) => t.outcome === 'catch');
	const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
	const clar = ratings.map((r) => r.clarity).filter((x): x is number => typeof x === 'number');
	const dist = ratings.map((r) => r.distraction).filter((x): x is number => typeof x === 'number');
	return {
		cue,
		trials: trials.length,
		engaged: trials.filter((t) => t.engaged).length,
		inRates: eligible.length,
		decisions: decisions.length,
		participants: new Set(trials.map((t) => t.participantId)).size,
		decisionParticipants: new Set(decisions.map((t) => t.participantId)).size,
		outcomes,
		...decisionRates(trials, cue, opts.wilsonOnly),
		catches: { n: catches.length, late: catches.filter(isLateCatch).length, share: eligible.length ? catches.length / eligible.length : null },
		turnAway: spread(decisions.map((t) => t.turnLeft).filter((x): x is number => x !== null)),
		wasted: spread(trials.filter((t) => t.outcome === 'early-retreat').map((t) => t.wasted).filter((x): x is number => x !== null)),
		nearMisses: trials.filter((t) => t.after.nearMiss).length,
		oldRules: trials.filter((t) => t.rulesVersion !== RULES_VERSION).length,
		clarity: { n: clar.length, mean: mean(clar) },
		distraction: { n: dist.length, mean: mean(dist) },
		notEnoughData: decisions.length < ENOUGH
	};
}
