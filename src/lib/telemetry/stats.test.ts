import { describe, expect, it } from 'vitest';
import { clusteredRates, quantile, spread, summarize, wilson, type TrialRow } from '#convex/lib/stats.ts';
import { RULES_VERSION } from '#convex/lib/rules.ts';

describe('wilson interval', () => {
	it('matches published values', () => {
		const a = wilson(5, 10);
		expect(a.rate).toBe(0.5);
		expect(a.lo!).toBeCloseTo(0.2366, 4);
		expect(a.hi!).toBeCloseTo(0.7634, 4);
		const b = wilson(0, 10);
		expect(b.lo).toBe(0);
		expect(b.hi!).toBeCloseTo(0.2775, 4);
		const c = wilson(10, 10);
		expect(c.lo!).toBeCloseTo(0.7225, 4);
		expect(c.hi).toBe(1);
		const d = wilson(81, 263);
		expect(d.lo!).toBeCloseTo(0.2553, 3);
		expect(d.hi!).toBeCloseTo(0.3662, 3);
	});

	it('has no rate without trials', () => {
		expect(wilson(0, 0)).toEqual({ k: 0, n: 0, rate: null, lo: null, hi: null });
	});

	it('narrows as n grows and always contains the rate', () => {
		let width = 1;
		for (const n of [5, 20, 80, 320]) {
			const r = wilson(Math.round(n * 0.3), n);
			expect(r.lo!).toBeLessThanOrEqual(r.rate!);
			expect(r.hi!).toBeGreaterThanOrEqual(r.rate!);
			expect(r.hi! - r.lo!).toBeLessThan(width);
			width = r.hi! - r.lo!;
		}
	});
});

describe('quantiles', () => {
	it('interpolates like numpy', () => {
		expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
		expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
		expect(quantile([7], 0.9)).toBe(7);
		expect(quantile([], 0.5)).toBeNull();
		const s = spread([3, 1, 2]);
		expect(s.values).toEqual([1, 2, 3]);
		expect(s.median).toBe(2);
		expect(s.mean).toBe(2);
	});
});

describe('participant-clustered intervals', () => {
	it('falls back to Wilson below 3 participants', () => {
		const r = clusteredRates([{ n: 10, k: [5] }, { n: 10, k: [5] }], 1, 'x');
		expect(r.method).toBe('wilson');
		expect(r.rates[0].lo!).toBeCloseTo(wilson(10, 20).lo!, 6);
	});

	it('is seeded, contains the rate, and is wider than Wilson when people differ', () => {
		// Six people: three always turn away in time, three never. Pooled 50%, but it hinges on who is drawn.
		const clusters = [0, 1, 2, 3, 4, 5].map((i) => ({ n: 20, k: [i < 3 ? 20 : 0] }));
		const a = clusteredRates(clusters, 1, 'cue'), b = clusteredRates(clusters, 1, 'cue');
		expect(a.method).toBe('bootstrap');
		expect(a.rates[0]).toEqual(b.rates[0]);
		expect(a.rates[0].rate).toBe(0.5);
		expect(a.rates[0].lo!).toBeLessThan(0.5);
		expect(a.rates[0].hi!).toBeGreaterThan(0.5);
		const w = wilson(60, 120);
		expect(a.rates[0].hi! - a.rates[0].lo!).toBeGreaterThan(2 * (w.hi! - w.lo!));
	});

	it('uses Wilson for a rate with no events (a bootstrap would collapse to a point)', () => {
		const clusters = Array.from({ length: 6 }, () => ({ n: 3, k: [0] }));
		const r = clusteredRates(clusters, 1, 'zero');
		expect(r.rates[0]).toMatchObject({ k: 0, n: 18, rate: 0, lo: 0, method: 'wilson' });
		expect(r.rates[0].hi!).toBeCloseTo(wilson(0, 18).hi!, 6);
	});

	it('is close to Wilson when everyone behaves alike', () => {
		const clusters = Array.from({ length: 30 }, () => ({ n: 10, k: [3] }));
		const r = clusteredRates(clusters, 1, 'same');
		expect(r.rates[0].lo).toBe(0.3);
		expect(r.rates[0].hi).toBe(0.3);
	});
});

describe('summarize', () => {
	const row = (outcome: string, extra: Partial<TrialRow> = {}): TrialRow => ({
		cue: 'timer-bar', participantId: 'p1', outcome, engaged: true, inRates: true, rulesVersion: RULES_VERSION, lateCatch: false,
		turnLeft: null, wasted: null, eats: [], after: { nearMiss: false, caught: outcome === 'caught' }, ...extra
	});

	it('divides by decision trials, reports catches apart, and reports n', () => {
		const trials = [
			row('caught', { turnLeft: -0.3 }), row('catch', { turnLeft: 1.2 }), row('catch', { turnLeft: 2.4 }),
			row('timely-retreat', { turnLeft: 0.8 }), row('overstayed', { turnLeft: 0.1 }),
			row('early-retreat', { turnLeft: 2.6, wasted: 2.6, participantId: 'p2' }),
			row('other'),
			row('not-engaged', { engaged: false, inRates: false }),
			row('interrupted', { inRates: false }),
			// Old rules: no stored measure to recompute it, so it counts nowhere.
			row('late-catch', { rulesVersion: 1, participantId: 'p3' })
		];
		const s = summarize('timer-bar', trials, [{ clarity: 6, distraction: 2 }, { clarity: 4 }]);
		expect(s.trials).toBe(10);
		expect(s.engaged).toBe(9);
		expect(s.inRates).toBe(7);
		expect(s.decisions).toBe(4);
		expect(s.participants).toBe(3);
		expect(s.decisionParticipants).toBe(2);
		expect(s.interval).toBe('wilson');
		expect(s.wellTimed).toMatchObject({ k: 1, n: 4, rate: 0.25 });
		expect(s.tooLate).toMatchObject({ k: 2, n: 4, rate: 0.5 });
		expect(s.caught).toMatchObject({ k: 1, n: 4, rate: 0.25 });
		expect(s.tooEarly).toMatchObject({ k: 1, n: 4, rate: 0.25 });
		expect(s.catches).toEqual({ n: 2, late: 1, share: 2 / 7 });
		expect(s.oldRules).toBe(1);
		// The old row was eligible (inRates), so the rates say they left it out.
		expect(s.leftOut.oldRules).toBe(1);
		expect(s.turnAway.values).toEqual([-0.3, 0.1, 0.8, 2.6]);
		expect(s.wasted.mean).toBe(2.6);
		expect(s.clarity).toEqual({ n: 2, mean: 5 });
		expect(s.distraction).toEqual({ n: 1, mean: 2 });
		expect(s.notEnoughData).toBe(true);
		expect(s.outcomes).toMatchObject({ caught: 1, catch: 2, 'not-engaged': 1, interrupted: 1, 'late-catch': 1 });
	});
});
