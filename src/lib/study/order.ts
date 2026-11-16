/**
 * Counterbalanced block orders for the guided study.
 *
 * Full session (every condition): a balanced Latin square (Williams design). Row r of an n x n
 * square is the sequence 0, 1, n-1, 2, n-2, ... shifted by r, so every condition appears once in
 * every position across n participants and, for even n, every condition directly follows every
 * other exactly once. For odd n (13 today) the n mirrored rows are added, giving 2n rows in which
 * each ordered pair of neighbours appears exactly twice. Participant number k uses row (k-1) mod
 * rows.
 *
 * Quick session (5 conditions): "No signal" and the timer bar always, plus 3 of the other ideas.
 * Participant k takes the next three in a fixed cycle through the others, so over every 11
 * participants each other condition is played exactly 3 times. The five are then ordered by a
 * balanced Latin square of size 5 (10 rows), row (k-1) mod 10. Because 10 and 11 share no factor,
 * the subset and its order vary independently.
 */
import type { CueId } from '../game/types';

export type StudyLength = 'quick' | 'full';

/** The always-present conditions of a quick session. */
export const QUICK_FIXED: CueId[] = ['none', 'timer-bar'];
export const QUICK_SIZE = 5;

/** Rows of a balanced Latin square for n conditions (n rows when n is even, 2n when odd). */
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

export interface StudyOrder {
	cues: CueId[];
	/** Row of the Latin square used (for the record). */
	row: number;
}

/**
 * The order of conditions for participant `number` (1, 2, 3...). `all` is every condition in its
 * display order (pass the registered cue ids, so the study copes with the list growing).
 */
export function studyOrder(number: number, length: StudyLength, all: CueId[]): StudyOrder {
	const k = Math.max(0, Math.floor(number) - 1);
	if (length === 'full' || all.length <= QUICK_SIZE) {
		const rows = balancedLatinSquare(all.length);
		const row = k % rows.length;
		return { cues: rows[row].map((i) => all[i]), row };
	}
	const fixed = QUICK_FIXED.filter((c) => all.includes(c));
	const others = all.filter((c) => !fixed.includes(c));
	const pick = QUICK_SIZE - fixed.length;
	const chosen = Array.from({ length: pick }, (_, j) => others[(k * pick + j) % others.length]);
	const set = [...fixed, ...chosen];
	const rows = balancedLatinSquare(set.length);
	const row = k % rows.length;
	return { cues: rows[row].map((i) => set[i]), row };
}
