import { describe, expect, it } from 'vitest';
import { allPairs, cellsOf, holm, paired, peopleNeeded, tCritical, tTwoSided, zQuantile } from './compare';

describe('distributions', () => {
	it('matches Student t tables', () => {
		expect(tCritical(1)).toBeCloseTo(12.706, 2);
		expect(tCritical(9)).toBeCloseTo(2.262, 3);
		expect(tCritical(29)).toBeCloseTo(2.045, 3);
		expect(tTwoSided(2.045, 29)).toBeCloseTo(0.05, 3);
		expect(tTwoSided(0, 10)).toBeCloseTo(1, 6);
	});
	it('matches the normal quantile', () => {
		expect(zQuantile(0.975)).toBeCloseTo(1.95996, 4);
		expect(zQuantile(0.8)).toBeCloseTo(0.84162, 4);
		expect(zQuantile(0.025)).toBeCloseTo(-1.95996, 4);
	});
});

describe('Holm', () => {
	it('adjusts step-down and keeps order', () => {
		expect(holm([0.01, 0.04, 0.03, null])).toEqual([0.03, 0.06, 0.06, null]);
	});
});

describe('paired differences', () => {
	const rows = (p: string, cue: string, well: number, n: number) =>
		Array.from({ length: n }, (_, i) => ({ participantId: p, cue, outcome: i < well ? 'timely-retreat' : 'overstayed' }));
	it('compares inside each person', () => {
		// Everyone is 50 points better under x than y, with a little spread.
		const t = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].flatMap((p, i) => [...rows(p, 'x', 3 + (i % 2), 4), ...rows(p, 'y', 1 + (i % 2), 4)]);
		const r = paired(cellsOf(t), 'x', 'y', 0);
		expect(r.people).toBe(6);
		expect(r.diff).toBeCloseTo(0.5, 6);
		expect(r.p).toBeCloseTo(2 ** -5, 9); // same difference in all 6: the sign-test p
		expect(r.lo).toBeCloseTo(0.5, 6);
	});
	it('gives no interval below 3 people', () => {
		const t = [...rows('p1', 'x', 2, 3), ...rows('p1', 'y', 1, 3), ...rows('p2', 'x', 2, 3), ...rows('p2', 'y', 1, 3)];
		const r = paired(cellsOf(t), 'x', 'y', 0);
		expect(r.people).toBe(2);
		expect(r.lo).toBeNull();
		expect(r.p).toBeNull();
	});
	it('needs every comparison of the family to clear Holm', () => {
		const t = ['a', 'b', 'c', 'd', 'e'].flatMap((p, i) => [...rows(p, 'x', 2 + (i % 3), 5), ...rows(p, 'y', 2 + ((i + 1) % 3), 5), ...rows(p, 'z', 2, 5)]);
		const fam = allPairs(cellsOf(t), ['x', 'y', 'z'], 0);
		expect(fam).toHaveLength(3);
		expect(fam.every((f) => !f.clear)).toBe(true);
	});
	it('sizes a study', () => {
		// SD 0.3, detect 0.15 at 5%, 80% power: (1.96 + 0.84)^2 * 4 + 1.92 = 33.3 -> 34.
		expect(peopleNeeded(0.3, 0.15, 0.05)).toBe(34);
	});
});
