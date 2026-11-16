/**
 * Counterbalanced cue orders for simulated sessions (STUDY.md "Design"): a balanced Latin square
 * row picked by participant number when the session plays every condition, a seeded shuffle when
 * it plays a subset. Pure and deterministic.
 */
import { makeRng } from '../game/engine/game';

/**
 * Row `row` of a balanced Latin square (Williams design) over n items, as indices.
 * Every item appears once per row, and across the rows each item follows every other item equally
 * often. For odd n that takes 2n rows: rows n..2n-1 are the first n reversed.
 */
export function williamsRow(n: number, row: number): number[] {
	if (n <= 0) return [];
	const rows = n % 2 === 0 ? n : 2 * n;
	const r = ((row % rows) + rows) % rows;
	// First row: 0, 1, n-1, 2, n-2, ...
	const base: number[] = [];
	for (let i = 0, lo = 1, hi = n - 1; i < n; i++) {
		if (i === 0) base.push(0);
		else if (i % 2 === 1) base.push(lo++);
		else base.push(hi--);
	}
	const shifted = base.map((v) => (v + (r % n)) % n);
	return r >= n ? shifted.reverse() : shifted;
}

/** Fisher-Yates shuffle with a seeded generator. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
	const rng = makeRng(seed);
	const a = items.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

/**
 * The cue order of a session. `all` is every condition in display order, `chosen` the ones this
 * session plays. All of them: Latin square row by participant number (1-based). A subset: shuffle
 * seeded by participant number and `seed`.
 */
export function cueOrder(all: readonly string[], chosen: readonly string[], participantNumber: number, seed: number): string[] {
	const set = new Set(chosen);
	const subset = all.filter((c) => set.has(c));
	if (subset.length === all.length) return williamsRow(all.length, participantNumber - 1).map((i) => all[i]);
	return seededShuffle(subset, seed * 1000 + participantNumber);
}
