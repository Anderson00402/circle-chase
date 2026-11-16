import { describe, expect, test } from 'vitest';
import { CUE_IDS } from '../game/cues/index';
import { balancedLatinSquare, caseOrder } from './order';

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

describe('case order', () => {
	const all = [...CUE_IDS];

	test('every participant gets every case once', () => {
		for (let p = 1; p <= 30; p++) expect([...caseOrder(p, all).cues].sort()).toEqual([...all].sort());
	});

	test('13 cases: 26 rows, the second half mirrors the first', () => {
		expect(caseOrder(27, all).cues).toEqual(caseOrder(1, all).cues);
		expect(caseOrder(14, all).cues).toEqual([...caseOrder(1, all).cues].reverse());
		expect(caseOrder(14, all).row).toBe(13);
	});

	test('over 26 participants each case opens the order twice', () => {
		const firsts = new Map<string, number>();
		for (let p = 1; p <= 26; p++) { const c = caseOrder(p, all).cues[0]; firsts.set(c, (firsts.get(c) ?? 0) + 1); }
		expect([...firsts.values()]).toEqual(new Array(13).fill(2));
	});

	test('copes with a shorter or longer list', () => {
		expect(caseOrder(3, ['none', 'timer-bar'] as never).cues.length).toBe(2);
		expect(caseOrder(3, [...all, 'x' as never]).cues.length).toBe(14);
		expect(caseOrder(1, []).cues).toEqual([]);
	});
});
