/**
 * Comparisons between conditions for the dashboard, using the within-subject design: every person
 * plays several conditions, so each comparison is made inside each person and then averaged over
 * people. Pure, so tests can check it (compare.test.ts).
 *
 * - Paired difference of A against B on a rate: for every participant with decision trials under
 *   both, their rate under A minus their rate under B. The estimate is the mean over those people;
 *   the 95% interval and the p-value come from a one-sample t-test on those differences (people are
 *   the unit, so the power-ups of one person are never treated as independent).
 * - Many comparisons at once (all 78 pairs of 13 conditions, or the 12 against the timer bar) are
 *   adjusted with Holm's method, so "clear" keeps a 5% chance of any false alarm over the family.
 * - A rough sample size: people needed to detect a given paired difference with 80% power.
 */

// ---------- distributions ----------

/** log Gamma (Lanczos approximation). */
function lgamma(x: number): number {
	const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
	if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
	x -= 1;
	let a = 0.99999999999980993;
	const t = x + 7.5;
	for (let i = 0; i < 8; i++) a += g[i] / (x + i + 1);
	return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes). */
function betacf(a: number, b: number, x: number): number {
	const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
	const qab = a + b, qap = a + 1, qam = a - 1;
	let c = 1, d = 1 - (qab * x) / qap;
	if (Math.abs(d) < FPMIN) d = FPMIN;
	d = 1 / d;
	let h = d;
	for (let m = 1; m <= MAXIT; m++) {
		const m2 = 2 * m;
		let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
		d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
		c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
		d = 1 / d; h *= d * c;
		aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
		d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
		c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
		d = 1 / d;
		const del = d * c;
		h *= del;
		if (Math.abs(del - 1) < EPS) break;
	}
	return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function ibeta(x: number, a: number, b: number): number {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
	return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value of Student's t with df degrees of freedom. */
export function tTwoSided(t: number, df: number): number {
	if (!Number.isFinite(t)) return 0;
	return ibeta(df / (df + t * t), df / 2, 0.5);
}

/** The t value whose two-sided p is `p` (e.g. 0.05 gives the 97.5th percentile). */
export function tCritical(df: number, p = 0.05): number {
	let lo = 0, hi = 1000;
	for (let i = 0; i < 100; i++) {
		const mid = (lo + hi) / 2;
		if (tTwoSided(mid, df) > p) lo = mid;
		else hi = mid;
	}
	return (lo + hi) / 2;
}

/** Standard normal quantile (Acklam's approximation, about 1e-9 relative error). */
export function zQuantile(p: number): number {
	const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
	const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
	const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
	const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
	const pl = 0.02425;
	if (p < pl) {
		const q = Math.sqrt(-2 * Math.log(p));
		return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
	}
	if (p > 1 - pl) return -zQuantile(1 - p);
	const q = p - 0.5, r = q * q;
	return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Holm's step-down adjustment. Returns adjusted p-values in the input order (null stays null). */
export function holm(ps: (number | null)[]): (number | null)[] {
	const idx = ps.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p !== null).sort((x, y) => x.p - y.p);
	const m = idx.length;
	const out: (number | null)[] = ps.map(() => null);
	let run = 0;
	idx.forEach(({ p, i }, r) => {
		run = Math.max(run, Math.min(1, (m - r) * p));
		out[i] = run;
	});
	return out;
}

// ---------- per-participant cells ----------

/** The four rates in a fixed order: well timed, too late, caught, too early. */
export const RATE_INDEX = { wellTimed: 0, tooLate: 1, caught: 2, tooEarly: 3 } as const;
export type RateKey = keyof typeof RATE_INDEX;

/** One participant's decision trials under one condition. */
export interface Cell {
	n: number;
	k: [number, number, number, number];
}
/** participant -> condition -> cell. */
export type Cells = Map<string, Map<string, Cell>>;

export function rateHits(outcome: string): [number, number, number, number] {
	return [
		outcome === 'timely-retreat' ? 1 : 0,
		outcome === 'caught' || outcome === 'overstayed' ? 1 : 0,
		outcome === 'caught' ? 1 : 0,
		outcome === 'early-retreat' ? 1 : 0
	];
}

/** Build the cells from decision trials. */
export function cellsOf(decisions: { participantId: string; cue: string; outcome: string }[]): Cells {
	const cells: Cells = new Map();
	for (const t of decisions) {
		let byCue = cells.get(t.participantId);
		if (!byCue) cells.set(t.participantId, (byCue = new Map()));
		let c = byCue.get(t.cue);
		if (!c) byCue.set(t.cue, (c = { n: 0, k: [0, 0, 0, 0] }));
		c.n++;
		const h = rateHits(t.outcome);
		for (let j = 0; j < 4; j++) c.k[j] += h[j];
	}
	return cells;
}

// ---------- paired differences ----------

/** Fewer paired people than this: no interval and no test. */
export const PAIR_MIN_PEOPLE = 3;

export interface Paired {
	a: string;
	b: string;
	/** People with decision trials under both. */
	people: number;
	/** Mean over people of (rate under a - rate under b), as a fraction; null without people. */
	diff: number | null;
	lo: number | null;
	hi: number | null;
	/** SD of the per-person differences. */
	sd: number | null;
	/** Two-sided p of the paired t-test (unadjusted). */
	p: number | null;
}

/** Per-person differences of rate j between conditions a and b. */
export function differences(cells: Cells, a: string, b: string, j: number): number[] {
	const ds: number[] = [];
	for (const byCue of cells.values()) {
		const ca = byCue.get(a), cb = byCue.get(b);
		if (ca && cb && ca.n > 0 && cb.n > 0) ds.push(ca.k[j] / ca.n - cb.k[j] / cb.n);
	}
	return ds;
}

export function pairedFrom(ds: number[], a: string, b: string): Paired {
	const P = ds.length;
	if (!P) return { a, b, people: 0, diff: null, lo: null, hi: null, sd: null, p: null };
	const mean = ds.reduce((x, y) => x + y, 0) / P;
	if (P < PAIR_MIN_PEOPLE) return { a, b, people: P, diff: mean, lo: null, hi: null, sd: null, p: null };
	const sd = Math.sqrt(ds.reduce((x, y) => x + (y - mean) ** 2, 0) / (P - 1));
	const se = sd / Math.sqrt(P);
	if (se === 0) {
		// Every person shows the same difference: no spread to test against. Zero is no evidence;
		// the same non-zero difference in every person is as strong as a sign test allows.
		return { a, b, people: P, diff: mean, lo: mean, hi: mean, sd: 0, p: mean === 0 ? 1 : Math.min(1, 2 ** (1 - P)) };
	}
	const half = tCritical(P - 1) * se;
	return {
		a, b, people: P, diff: mean, lo: Math.max(-1, mean - half), hi: Math.min(1, mean + half), sd,
		p: tTwoSided(mean / se, P - 1)
	};
}

export function paired(cells: Cells, a: string, b: string, j: number): Paired {
	return pairedFrom(differences(cells, a, b, j), a, b);
}

export interface Adjusted extends Paired {
	/** Holm-adjusted p within its family. */
	pAdj: number | null;
	/** pAdj < 0.05: the difference is clear even after allowing for every comparison in the family. */
	clear: boolean;
}

export const ALPHA = 0.05;

/** A family of comparisons, Holm-adjusted together. */
export function family(list: Paired[]): Adjusted[] {
	const adj = holm(list.map((x) => x.p));
	return list.map((x, i) => ({ ...x, pAdj: adj[i], clear: adj[i] !== null && adj[i]! < ALPHA }));
}

/** Every pair of `ids` (a before b in the given order) on rate j, Holm-adjusted as one family. */
export function allPairs(cells: Cells, ids: string[], j: number): Adjusted[] {
	const list: Paired[] = [];
	for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) list.push(paired(cells, ids[i], ids[k], j));
	return family(list);
}

/** Each of `ids` against the reference on rate j, Holm-adjusted as one family. */
export function againstRef(cells: Cells, ids: string[], ref: string, j: number): Adjusted[] {
	return family(ids.filter((id) => id !== ref).map((id) => paired(cells, id, ref, j)));
}

// ---------- precision ----------

/**
 * People needed to detect a paired difference `delta` (fraction) with the given SD of per-person
 * differences, two-sided test at level `alpha`, with `power`. Normal approximation plus the usual
 * small-sample correction (z^2 / 2).
 */
export function peopleNeeded(sd: number, delta: number, alpha: number, power = 0.8): number {
	const za = zQuantile(1 - alpha / 2), zb = zQuantile(power);
	return Math.ceil(((za + zb) * sd / delta) ** 2 + (za * za) / 2);
}

/** Pooled SD of per-person differences over several comparisons (weighted by degrees of freedom). */
export function pooledSd(list: Paired[]): number | null {
	let num = 0, df = 0;
	for (const x of list) if (x.sd !== null && x.people >= PAIR_MIN_PEOPLE) {
		num += x.sd * x.sd * (x.people - 1);
		df += x.people - 1;
	}
	return df ? Math.sqrt(num / df) : null;
}

export function median(xs: number[]): number | null {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
