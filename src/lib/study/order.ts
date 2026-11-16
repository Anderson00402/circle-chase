/**
 * The counterbalanced order of cases the run console suggests (docs/STUDY.md "Design").
 *
 * A balanced Latin square (Williams design): row r of an n x n square is the sequence
 * 0, 1, n-1, 2, n-2, ... shifted by r, so every case appears once in every position across n
 * participants and, for even n, every case directly follows every other exactly once. For odd n
 * (13 today) the n mirrored rows are added, giving 2n rows in which each ordered pair of
 * neighbours appears exactly twice. Participant number k uses row (k-1) mod rows.
 */
import type { CueId } from '../game/types';

/** Rows of a balanced Latin square for n cases (n rows when n is even, 2n when odd). */
export function balancedLatinSquare(n: number): number[][] {
	if (n <= 0) return [];
	const first: number[] = [];
	for (let i = 0, lo = 1, hi = n - 1; i < n; i++) {
		if (i === 0) first.push(0);
		else if (i % 2 === 1) first.push(lo++);
		else first.push(hi--);
	}
	const rows = Array.from({ length: n }, (_, r) => first.map((x) => (x + r) % n));
	if (n % 2 === 1) for (let r = 0; r < n; r++) rows.push([...rows[r]].reverse());
	return rows;
}

export interface CaseOrder {
	cues: CueId[];
	/** Row of the Latin square used (stored on the session). */
	row: number;
}

/**
 * Suggested order for participant `number` (1, 2, 3...). `all` is every case in display order
 * (pass the registered ids, so the order copes with the list growing).
 */
export function caseOrder(number: number, all: CueId[]): CaseOrder {
	const k = Math.max(0, Math.floor(number) - 1);
	const rows = balancedLatinSquare(all.length);
	if (!rows.length) return { cues: [], row: 0 };
	const row = k % rows.length;
	return { cues: rows[row].map((i) => all[i]), row };
}
