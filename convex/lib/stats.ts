/**
 * Numbers for the dashboard, computed from plain trial rows. Pure, so the browser can reuse it and
 * tests can check it. Definitions follow docs/STUDY.md "Headline numbers per cue".
 */

export interface Rate {
	/** Trials that count (k) out of n. */
	k: number;
	n: number;
	/** k / n, or null when n = 0. */
	rate: number | null;
	/** 95% Wilson interval; null when n = 0. */
	lo: number | null;
	hi: number | null;
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

/** The fields of a trial row the summary needs. */
export interface TrialRow {
	cue: string;
	participantId: string;
	outcome: string;
	engaged: boolean;
	inRates: boolean;
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

export interface CueSummary {
	cue: string;
	trials: number;
	/** Engaged trials (any end). */
	engaged: number;
	/** Engaged trials whose power ran out by itself: the denominator of every rate. */
	inRates: number;
	participants: number;
	outcomes: Record<string, number>;
	/** caught / inRates. Lower is better. */
	caught: Rate;
	/** (late catch + timely retreat) / inRates. Higher is better. */
	wellTimed: Rate;
	/** Turn-away time of trials that count, seconds of power left (negative after the end). */
	turnAway: Spread;
	/** Power left unused after an early retreat (all early retreats with a ghost still reachable). */
	wasted: Spread;
	/** Trials with a ghost eaten with 1.5 s or less left. */
	lateCatches: number;
	nearMisses: number;
	clarity: { n: number; mean: number | null };
	distraction: { n: number; mean: number | null };
	/** Fewer than 10 trials count toward the rates. */
	notEnoughData: boolean;
}

export const ENOUGH = 10;

export function summarize(cue: string, trials: TrialRow[], ratings: RatingRow[]): CueSummary {
	const counted = trials.filter((t) => t.inRates);
	const outcomes: Record<string, number> = {};
	for (const t of trials) outcomes[t.outcome] = (outcomes[t.outcome] ?? 0) + 1;
	const caught = counted.filter((t) => t.outcome === 'caught').length;
	const well = counted.filter((t) => t.outcome === 'late-catch' || t.outcome === 'timely-retreat').length;
	const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
	const clar = ratings.map((r) => r.clarity).filter((x): x is number => typeof x === 'number');
	const dist = ratings.map((r) => r.distraction).filter((x): x is number => typeof x === 'number');
	return {
		cue,
		trials: trials.length,
		engaged: trials.filter((t) => t.engaged).length,
		inRates: counted.length,
		participants: new Set(trials.map((t) => t.participantId)).size,
		outcomes,
		caught: wilson(caught, counted.length),
		wellTimed: wilson(well, counted.length),
		turnAway: spread(counted.map((t) => t.turnLeft).filter((x): x is number => x !== null)),
		wasted: spread(trials.map((t) => t.wasted).filter((x): x is number => x !== null)),
		lateCatches: trials.filter((t) => t.lateCatch).length,
		nearMisses: trials.filter((t) => t.after.nearMiss).length,
		clarity: { n: clar.length, mean: mean(clar) },
		distraction: { n: dist.length, mean: mean(dist) },
		notEnoughData: counted.length < ENOUGH
	};
}
