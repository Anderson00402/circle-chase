import { describe, expect, test } from 'vitest';
import { CUE_IDS } from '../game/cues/index';
import { balancedLatinSquare, studyOrder } from './order';

function checkSquare(n: number) {
	const rows = balancedLatinSquare(n);
	expect(rows.length).toBe(n % 2 ? 2 * n : n);
	// Every row is a permutation.
	for (const r of rows) expect([...r].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
	// Every condition appears equally often in every position.
	for (let pos = 0; pos < n; pos++) {
		const counts = new Array(n).fill(0);
		for (const r of rows) counts[r[pos]]++;
		expect(new Set(counts).size).toBe(1);
	}
	// Every ordered pair of neighbours appears equally often (once, or twice for odd n).
	const pairs = new Map<string, number>();
	for (const r of rows) for (let i = 1; i < n; i++) pairs.set(`${r[i - 1]}>${r[i]}`, (pairs.get(`${r[i - 1]}>${r[i]}`) ?? 0) + 1);
	expect(pairs.size).toBe(n * (n - 1));
	expect(new Set(pairs.values())).toEqual(new Set([n % 2 ? 2 : 1]));
}

describe('balanced Latin square', () => {
	test.each([2, 4, 5, 6, 12, 13, 14])('n = %i is balanced', (n) => checkSquare(n));
});

describe('study order', () => {
	const all = [...CUE_IDS];

	test('full session plays every condition once', () => {
		for (let p = 1; p <= 30; p++) {
			const o = studyOrder(p, 'full', all);
			expect([...o.cues].sort()).toEqual([...all].sort());
		}
		// 13 conditions: 26 rows, so participant 27 repeats participant 1.
		expect(studyOrder(27, 'full', all).cues).toEqual(studyOrder(1, 'full', all).cues);
		expect(studyOrder(14, 'full', all).cues).toEqual([...studyOrder(1, 'full', all).cues].reverse());
	});

	test('quick session: 5 conditions, always the control and the timer bar, others evenly covered', () => {
		const seen = new Map<string, number>();
		const firsts = new Map<string, number>();
		for (let p = 1; p <= 110; p++) {
			const o = studyOrder(p, 'quick', all);
			expect(o.cues.length).toBe(5);
			expect(new Set(o.cues).size).toBe(5);
			expect(o.cues).toContain('none');
			expect(o.cues).toContain('timer-bar');
			for (const c of o.cues) seen.set(c, (seen.get(c) ?? 0) + 1);
			firsts.set(o.cues[0], (firsts.get(o.cues[0]) ?? 0) + 1);
		}
		// Over 110 participants each of the 11 others is played exactly 30 times.
		for (const c of all.filter((c) => c !== 'none' && c !== 'timer-bar')) expect(seen.get(c)).toBe(30);
		// The control and the timer bar open the session one time in five.
		expect(firsts.get('none')).toBe(22);
		expect(firsts.get('timer-bar')).toBe(22);
	});

	test('copes with a shorter or longer list', () => {
		expect(studyOrder(3, 'quick', ['none', 'timer-bar', 'a', 'b'] as never).cues.length).toBe(4);
		expect(studyOrder(3, 'full', [...all, 'x' as never]).cues.length).toBe(14);
	});
});
