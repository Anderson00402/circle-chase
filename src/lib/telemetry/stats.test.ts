import { describe, expect, it } from 'vitest';
import { quantile, spread, summarize, wilson, type TrialRow } from '#convex/lib/stats.ts';

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

describe('summarize', () => {
	const row = (outcome: string, extra: Partial<TrialRow> = {}): TrialRow => ({
		cue: 'timer-bar', participantId: 'p1', outcome, engaged: true, inRates: true, lateCatch: outcome === 'late-catch',
		turnLeft: null, wasted: null, eats: [], after: { nearMiss: false, caught: outcome === 'caught' }, ...extra
	});

	it('uses only trials that count for the rates and reports n', () => {
		const trials = [
			row('caught'), row('late-catch'), row('timely-retreat', { turnLeft: 0.8 }), row('overstayed'),
			row('early-retreat', { turnLeft: 2.6, wasted: 2.6, participantId: 'p2' }),
			row('not-engaged', { engaged: false, inRates: false }),
			row('interrupted', { inRates: false })
		];
		const s = summarize('timer-bar', trials, [{ clarity: 6, distraction: 2 }, { clarity: 4 }]);
		expect(s.trials).toBe(7);
		expect(s.engaged).toBe(6);
		expect(s.inRates).toBe(5);
		expect(s.participants).toBe(2);
		expect(s.caught).toMatchObject({ k: 1, n: 5, rate: 0.2 });
		expect(s.wellTimed).toMatchObject({ k: 2, n: 5, rate: 0.4 });
		expect(s.turnAway.values).toEqual([0.8, 2.6]);
		expect(s.wasted.mean).toBe(2.6);
		expect(s.clarity).toEqual({ n: 2, mean: 5 });
		expect(s.distraction).toEqual({ n: 1, mean: 2 });
		expect(s.notEnoughData).toBe(true);
		expect(s.outcomes).toMatchObject({ caught: 1, 'not-engaged': 1, interrupted: 1 });
	});
});
