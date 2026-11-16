import { describe, expect, it } from 'vitest';
import { wilson } from '#convex/lib/stats.ts';
import { insight, type CondStats, type Named } from './insight';

const NAMES: Record<string, Named> = {
	none: { code: 'A', name: 'No signal', role: 'reference' },
	'classic-blink': { code: 'B', name: 'Classic blink', role: 'reference' },
	'timer-bar': { code: '0', name: 'Timer bar', role: 'baseline' },
	'ink-refill': { code: '1', name: 'Ink refill', role: 'idea' },
	'clock-halos': { code: '2', name: 'Clock halos', role: 'idea' }
};
const ids = Object.keys(NAMES);
const named = (id: string) => NAMES[id];
const cond = (cue: string, well: number, caught: number, n: number): CondStats => ({
	cue, inRates: n, wellTimed: wilson(well, n), caught: wilson(caught, n)
});

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

	it('says intervals overlap when they do, even with a higher rate', () => {
		const r = insight([cond('ink-refill', 7, 1, 12), cond('timer-bar', 5, 2, 12)], named, ids);
		expect(r.tone).toBe('overlap');
		expect(r.headline).toMatch(/Ink refill \(1\) is ahead/);
		expect(r.headline).toMatch(/overlap/);
		expect(r.headline).not.toMatch(/clearly ahead/);
	});

	it('names a clear winner only when its interval clears every other one', () => {
		const r = insight([cond('ink-refill', 90, 2, 100), cond('timer-bar', 40, 10, 100), cond('none', 10, 40, 100)], named, ids);
		expect(r.tone).toBe('clear');
		expect(r.beats['timer-bar']).toEqual(['ink-refill']);
		expect(r.details.join(' ')).toMatch(/clearly better than the timer bar/);
	});

	it('is partial when the leader clears some but not all', () => {
		const r = insight([cond('ink-refill', 60, 2, 100), cond('clock-halos', 55, 5, 100), cond('none', 10, 40, 100)], named, ids);
		expect(r.tone).toBe('partial');
		expect(r.headline).toMatch(/not a clear winner/);
	});

	it('mentions conditions without enough data', () => {
		const r = insight([cond('ink-refill', 6, 1, 12), cond('timer-bar', 5, 2, 12)], named, ids);
		expect(r.details.join(' ')).toMatch(/3 of 5 conditions have fewer than 10/);
	});
});
