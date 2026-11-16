import { describe, expect, it } from 'vitest';
import { wilson } from '#convex/lib/stats.ts';
import { insight, type Cmp, type CondStats, type Comparisons, type Named } from './insight';
import flat from './fixtures/flat-run.json';
import planted from './fixtures/planted-run.json';

const NAMES: Record<string, Named> = {
	none: { code: 'A', name: 'No signal', role: 'reference' },
	'classic-blink': { code: 'B', name: 'Classic blink', role: 'reference' },
	'timer-bar': { code: '0', name: 'Timer bar', role: 'baseline' },
	'ink-refill': { code: '1', name: 'Ink refill', role: 'idea' },
	'clock-halos': { code: '2', name: 'Clock halos', role: 'idea' }
};
const ids = Object.keys(NAMES);
const named = (id: string) => NAMES[id] ?? { code: id.slice(0, 2), name: id, role: 'idea' as const };
const cond = (cue: string, well: number, caught: number, n: number): CondStats => ({
	cue, decisions: n, wellTimed: wilson(well, n), tooLate: wilson(caught, n), tooEarly: wilson(n - well - caught, n), caught: wilson(caught, n)
});
const c = (a: string, b: string, diff: number, clear: boolean): Cmp => ({ a, b, people: 20, diff, clear });
const cmps = (well: Cmp[], vsTimer: Cmp[] = []): Comparisons => ({ pairs: { wellTimed: well, tooLate: [], tooEarly: [] }, vsTimer });

describe('dashboard takeaway', () => {
	it('says there is no answer without data', () => {
		expect(insight([], named, ids).tone).toBe('empty');
	});

	it('does not rank anything below 10 counted trials', () => {
		const r = insight([cond('timer-bar', 8, 0, 9), cond('none', 1, 5, 9)], named, ids);
		expect(r.tone).toBe('thin');
		expect(r.ranked).toEqual([]);
		expect(r.headline).toMatch(/Not enough data/);
	});

	it('leads with "no condition is clearly best" and names the highest only second', () => {
		const r = insight([cond('ink-refill', 70, 1, 100), cond('timer-bar', 40, 2, 100)], named, ids, cmps([c('ink-refill', 'timer-bar', 0.3, false)]));
		expect(r.tone).toBe('none');
		expect(r.headline).toMatch(/^No condition is clearly best yet/);
		expect(r.headline).not.toMatch(/Ink refill/);
		expect(r.details[0]).toMatch(/highest well-timed rate is Ink refill \(1\) at 70%/);
	});

	it('does not call non-overlapping intervals clear without the adjusted comparison', () => {
		// Intervals far apart, but no comparison was made (or it was not clear after adjustment).
		const r = insight([cond('ink-refill', 90, 2, 100), cond('timer-bar', 40, 10, 100), cond('none', 10, 40, 100)], named, ids);
		expect(r.tone).toBe('none');
		expect(r.headline).not.toMatch(/tells players best/);
	});

	it('names a clear winner only when it is clearly ahead of every other condition', () => {
		const stats = [cond('ink-refill', 90, 2, 100), cond('timer-bar', 40, 10, 100), cond('none', 10, 40, 100)];
		const all = [c('ink-refill', 'timer-bar', 0.5, true), c('ink-refill', 'none', 0.8, true), c('timer-bar', 'none', 0.3, true)];
		const r = insight(stats, named, ids, cmps(all, [c('ink-refill', 'timer-bar', 0.5, true), c('none', 'timer-bar', -0.3, true)]));
		expect(r.tone).toBe('clear');
		expect(r.headline).toMatch(/^Ink refill \(1\) tells players best/);
		expect(r.headline).toMatch(/allowing for 3 comparisons/);
		expect(r.beatsTimer).toEqual(['ink-refill']);
		expect(r.details.join(' ')).toMatch(/clearly better: Ink refill \(1\); clearly worse: No signal \(A\)/);
	});

	it('says what is separated when some pairs differ but there is no clear best', () => {
		const stats = [cond('ink-refill', 60, 2, 100), cond('clock-halos', 55, 5, 100), cond('none', 10, 40, 100)];
		const all = [c('ink-refill', 'clock-halos', 0.05, false), c('ink-refill', 'none', 0.5, true), c('clock-halos', 'none', 0.45, true)];
		const r = insight(stats, named, ids, cmps(all));
		expect(r.tone).toBe('some');
		expect(r.headline).toBe('No condition is clearly best yet.');
		expect(r.details[0]).toMatch(/not clearly ahead of one other condition/);
		expect(r.details[1]).toMatch(/2 of 3 pairs differ clearly/);
		expect(r.details[1]).toMatch(/Clearly behind at least one other: No signal \(A\), behind 2/);
	});

	it('mentions conditions without enough data', () => {
		const r = insight([cond('ink-refill', 6, 1, 12), cond('timer-bar', 5, 2, 12)], named, ids);
		expect(r.details.join(' ')).toMatch(/3 of 5 conditions have fewer than 10/);
	});
});

describe('takeaway on real simulator runs', () => {
	const all = (f: typeof flat) => f.cues.map((x) => x.cue);
	const run = (f: typeof flat) => insight(f.cues as CondStats[], named, all(f), { pairs: f.pairs as Comparisons['pairs'], vsTimer: f.vsTimer as Cmp[] });

	it('reads as "no real differences" on the flat run', () => {
		const r = run(flat);
		expect(r.tone).toBe('none');
		expect(r.headline).toMatch(/^No condition is clearly best yet: across all 78 pairs of conditions, no difference is larger than chance/);
		expect(r.separated).toEqual({ k: 0, of: 78 });
		expect(r.beatsTimer).toEqual([]);
		const text = r.details.join(' ');
		expect(text).toMatch(/no idea does clearly better yet/);
		expect(text).not.toMatch(/clearly worse/);
		expect(text).not.toMatch(/clearly fewer/);
	});

	it('says what is and is not separated on the planted run', () => {
		const r = run(planted);
		// Nothing is the clear best and the leader is not named in the headline.
		expect(r.tone).not.toBe('clear');
		expect(r.headline).toMatch(/^No condition is clearly best yet/);
		const text = r.details.join(' ');
		// The planted weak conditions show up as clearly worse than the timer bar.
		expect(text).toMatch(/clearly worse: .*No signal \(A\)/);
		expect(text).toMatch(/The highest well-timed rate is/);
	});
});
