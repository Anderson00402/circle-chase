import { describe, expect, it } from 'vitest';
import { wilson } from '#convex/lib/stats.ts';
import { CONDITIONS, condition } from '#lib/charts/encoding.ts';
import { insight, topGroups, type Cmp, type CondStats, type Comparisons, type Named } from './insight';
import flat from './fixtures/flat-run.json';
import planted from './fixtures/planted-run.json';
import thin from './fixtures/thin-run.json';

const NAMES: Record<string, Named> = {
	none: { code: 'A', name: 'No signal', role: 'reference' },
	'classic-blink': { code: 'B', name: 'Classic blink', role: 'reference' },
	'timer-bar': { code: '0', name: 'Timer bar', role: 'baseline' },
	'ink-refill': { code: '1', name: 'Ink refill', role: 'idea' },
	'clock-halos': { code: '2', name: 'Clock halos', role: 'idea' }
};
const ids = Object.keys(NAMES);
const named = (id: string) => NAMES[id] ?? { code: id.slice(0, 2), name: id, role: 'idea' as const };
const cond = (cue: string, well: number, caught: number, n: number, people = 20): CondStats => ({
	cue, decisions: n, decisionParticipants: people, wellTimed: wilson(well, n), tooLate: wilson(caught, n), tooEarly: wilson(n - well - caught, n), caught: wilson(caught, n)
});
const c = (a: string, b: string, diff: number, clear: boolean, people = 20): Cmp => ({ a, b, people, diff, clear });
const cmps = (well: Cmp[], vsTimer: Cmp[] = []): Comparisons => ({ pairs: { wellTimed: well, tooLate: [], tooEarly: [] }, vs: { 'timer-bar': vsTimer } });

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

	it('does not rank a condition with counted power-ups from fewer than 5 people', () => {
		const r = insight([cond('timer-bar', 30, 2, 40, 4), cond('none', 10, 10, 40, 4)], named, ids);
		expect(r.tone).toBe('thin');
		expect(r.ranked).toEqual([]);
		expect(r.headline).toBe('Too few people to compare conditions yet: a condition needs counted power-ups from 5 people, and the most so far is 4.');
	});

	it('says "too few people" when no pair could be tested, never "no difference"', () => {
		// Ranked (5 people each), but no pair has 5 people who played both.
		const stats = [cond('ink-refill', 30, 2, 40, 5), cond('timer-bar', 10, 2, 40, 5)];
		const r = insight(stats, named, ids, cmps([c('ink-refill', 'timer-bar', 0.5, false, 3)]));
		expect(r.tone).toBe('few');
		expect(r.headline).toMatch(/^Too few people to compare conditions yet: a comparison needs 5 people who played both, and the most so far is 3\./);
		expect(r.headline + r.details.join(' ')).not.toMatch(/chance|differ/);
	});

	it('leads with "no condition stands out" and names the highest only second', () => {
		const r = insight([cond('ink-refill', 70, 1, 100), cond('timer-bar', 40, 2, 100)], named, ids, cmps([c('ink-refill', 'timer-bar', 0.3, false)]));
		expect(r.tone).toBe('none');
		expect(r.headline).toBe('No condition stands out yet: none of the 1 pairs of conditions differs by more than chance would explain.');
		expect(r.details[0]).toMatch(/^Most often turned away in time: Ink refill \(1\) at 70%/);
		expect(r.groups).toBeNull();
	});

	it('says how many pairs could not be tested', () => {
		const stats = [cond('ink-refill', 60, 1, 100), cond('clock-halos', 50, 2, 100), cond('timer-bar', 40, 2, 100)];
		const r = insight(stats, named, ids, cmps([c('ink-refill', 'clock-halos', 0.1, false), c('ink-refill', 'timer-bar', 0.2, false, 4), c('clock-halos', 'timer-bar', 0.1, false)]));
		expect(r.tone).toBe('none');
		expect(r.separated).toEqual({ k: 0, tested: 2, of: 3 });
		expect(r.headline).toMatch(/none of the 2 pairs of conditions that could be tested differs by more than chance \(1 more has too few people who played both\)/);
	});

	it('does not call non-overlapping intervals clear without the adjusted comparison', () => {
		const r = insight([cond('ink-refill', 90, 2, 100), cond('timer-bar', 40, 10, 100), cond('none', 10, 40, 100)], named, ids);
		expect(r.headline).not.toMatch(/tells players best|clearly ahead/);
	});

	it('names a clear winner only when it is clearly ahead of every other condition', () => {
		const stats = [cond('ink-refill', 90, 2, 100), cond('timer-bar', 40, 10, 100), cond('none', 10, 40, 100)];
		const all = [c('ink-refill', 'timer-bar', 0.5, true), c('ink-refill', 'none', 0.8, true), c('timer-bar', 'none', 0.3, true)];
		const r = insight(stats, named, ids, cmps(all, [c('ink-refill', 'timer-bar', 0.5, true), c('none', 'timer-bar', -0.3, true)]));
		expect(r.tone).toBe('clear');
		expect(r.headline).toMatch(/^Ink refill \(1\) tells players best/);
		expect(r.headline).toMatch(/allowing for 3 comparisons/);
		expect(r.beatsTimer).toEqual(['ink-refill']);
		expect(r.details.join(' ')).toMatch(/Against the timer bar \(40%\), of 1 ranked idea: 1 clearly better \(Ink refill\)\./);
	});

	it('leads with a clean top group when it is clearly ahead of every other condition', () => {
		const stats = [cond('ink-refill', 62, 2, 100), cond('clock-halos', 60, 5, 100), cond('none', 10, 40, 100)];
		const all = [c('ink-refill', 'clock-halos', 0.02, false), c('ink-refill', 'none', 0.5, true), c('clock-halos', 'none', 0.45, true)];
		const r = insight(stats, named, ids, cmps(all));
		expect(r.tone).toBe('group');
		expect(r.headline).toBe('Ink refill and Clock halos are clearly ahead of the one other condition; they cannot be told apart from each other yet.');
		expect(r.groups).toEqual({ top: ['ink-refill', 'clock-halos'], leaders: ['ink-refill', 'clock-halos'], behind: ['none'], clean: true });
	});

	it('does not claim a member of the top group is ahead of what it is not clearly ahead of', () => {
		// The highest is clearly ahead of the lowest; the second is not.
		const stats = [cond('ink-refill', 70, 2, 100), cond('clock-halos', 50, 5, 100), cond('none', 30, 40, 100)];
		const all = [c('ink-refill', 'clock-halos', 0.2, false), c('ink-refill', 'none', 0.4, true), c('clock-halos', 'none', 0.2, false)];
		const r = insight(stats, named, ids, cmps(all));
		expect(r.tone).toBe('group');
		expect(r.groups).toEqual({ top: ['ink-refill', 'clock-halos'], leaders: ['ink-refill'], behind: ['none'], clean: false });
		expect(r.headline).toBe('Ink refill leads: it is clearly ahead of 1 other, but not yet of 1 more.');
	});

	it('mentions conditions without enough data', () => {
		const r = insight([cond('ink-refill', 16, 1, 22), cond('timer-bar', 5, 2, 12)], named, ids, cmps([c('ink-refill', 'timer-bar', 0.1, false)]));
		expect(r.more.join(' ')).toMatch(/3 of 5 conditions have fewer than 10 counted power-ups or fewer than 5 people/);
	});
});

describe('takeaway on the simulator runs (rules v3, fleeing ghosts, 40 simulated players each)', () => {
	const allIds = CONDITIONS.map((x) => x.id);
	type Fixture = { cues: unknown[]; pairs: unknown; vs: unknown; top: unknown };
	const run = (f: Fixture) =>
		insight(f.cues as CondStats[], condition, allIds, { pairs: f.pairs as Comparisons['pairs'], vs: f.vs as Comparisons['vs'], top: f.top as Comparisons['top'] });

	it('flat run: nothing stands out, and nothing is called clear', () => {
		const r = run(flat);
		expect(r.tone).toBe('none');
		expect(r.headline).toBe('No condition stands out yet: none of the 78 pairs of conditions differs by more than chance would explain.');
		expect(r.separated).toEqual({ k: 0, tested: 78, of: 78 });
		expect(r.groups).toBeNull();
		expect(r.beatsTimer).toEqual([]);
		const text = [...r.details, ...r.more].join(' ');
		expect(text).toMatch(/Against the timer bar \(\d+%\), of 10 ranked ideas: none clearly better and 10 not told apart\./);
		expect(text).toMatch(/Still undecided: which conditions differ at all and whether any idea beats the timer bar\./);
		expect(text).not.toMatch(/clearly worse|clearly fewer|differ clearly/);
	});

	it('planted run: leads with the leaders, marks the top group, and how ideas stand against each yardstick', () => {
		const r = run(planted);
		expect(r.tone).toBe('group');
		expect(r.headline).toBe('Timer bar and Final count lead: each is clearly ahead of 5 others, and they cannot be told apart from each other yet.');
		expect(r.groups!.leaders).toEqual(['timer-bar', 'final-count']);
		expect(r.groups!.top).toHaveLength(8);
		expect(r.groups!.behind).toEqual(['wall-tide', 'heartbeat', 'pen-hourglass', 'none', 'dot-sweep']);
		expect(r.separated).toEqual({ k: 20, tested: 78, of: 78 });
		const text = [...r.details, ...r.more].join(' ');
		expect(text).toMatch(/Clearly behind each of the leaders: Wall tide \(4\) 48%, Heartbeat \(5\) 47%, Pen hourglass \(7\) 38%, No signal \(A\) 35% and Dot sweep \(10\) 35%\./);
		expect(text).toMatch(/Against the timer bar \(76%\), of 10 ranked ideas: none clearly better, 6 clearly worse/);
		expect(text).toMatch(/Against the classic blink \(54%\), of 10 ranked ideas: 1 clearly better \(Final count\), 2 clearly worse/);
		expect(text).toMatch(/Against no signal \(35%\), of 10 ranked ideas: 6 clearly better/);
		expect(text).toMatch(/Still undecided: the order inside the top group \(Timer bar and Final count are 4 points apart; telling them apart would take about [\d,]+ people\)/);
	});

	it('every claim in the planted headline is backed by a clear adjusted comparison', () => {
		const g = topGroups((planted.cues as CondStats[]).sort((a, b) => (b.wellTimed.rate ?? 0) - (a.wellTimed.rate ?? 0)).map((x) => x.cue), planted.pairs.wellTimed as Cmp[])!;
		for (const l of g.leaders) for (const b of g.behind) {
			const x = (planted.pairs.wellTimed as Cmp[]).find((p) => (p.a === l && p.b === b) || (p.a === b && p.b === l))!;
			expect(x.clear).toBe(true);
			expect(x.a === l ? x.diff! > 0 : x.diff! < 0).toBe(true);
		}
		for (const a of g.leaders) for (const b of g.leaders) {
			if (a === b) continue;
			expect((planted.pairs.wellTimed as Cmp[]).find((p) => p.a === a && p.b === b)?.clear ?? false).toBe(false);
		}
	});

	it('thin data (the planted run cut to its first 5%, 4 people): too few people, no ranking', () => {
		const r = run(thin);
		expect(r.tone).toBe('thin');
		expect(r.ranked).toEqual([]);
		expect(r.headline).toBe('Too few people to compare conditions yet: a condition needs counted power-ups from 5 people, and the most so far is 4.');
		expect(r.headline + r.details.join(' ')).not.toMatch(/chance|differ/);
	});
});
