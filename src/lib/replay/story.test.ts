import { describe as group, expect, it } from 'vitest';
import { describe, tilesNum, tilesText, type StoryTrial } from './story';
import { notCountedReason } from '#convex/lib/reasons.ts';
import { RULES_VERSION } from '#convex/lib/rules.ts';

const base: StoryTrial = {
	outcome: 'timely-retreat', rulesVersion: RULES_VERSION, total: 6, endReason: 'expired', turnLeft: 1.2, turnDist: 2.5, endDist: 8,
	lastChaseEnd: 'turn', chaseEndDist: 9, eats: [], allEatenLeft: null, wasted: null, reaction: null,
	after: { died: false, caught: false, timeToCaught: null, killer: null, nearMiss: false, minDangerDist: 9, cut: null, seen: 3 }
};
const t = (patch: Partial<StoryTrial>, after: Partial<StoryTrial['after']> = {}): StoryTrial => ({ ...base, ...patch, after: { ...base.after, ...after } });

group('describe', () => {
	it('tells a last chase that ended in an eat as an eat, never a turn-away', () => {
		const s = describe(t({ outcome: 'caught', lastChaseEnd: 'eat', turnLeft: 5.7, eats: [{ t: 2, left: 5.7, ghost: 'ambusher' }], endDist: 2.4 }, { died: true, caught: true, timeToCaught: 0.1, killer: 'guard' }));
		expect(s).toMatch(/^Ate the Ambusher with 5\.7 s left/);
		expect(s).not.toMatch(/Turned away/);
		expect(s).toMatch(/caught by the Guard/);
	});
	it('says "died", not "caught", for a death in a trial that is not classed caught', () => {
		const s = describe(t({ outcome: 'catch', lastChaseEnd: 'eat', eats: [{ t: 5, left: 1.1, ghost: 'guard' }] }, { died: true, caught: true, timeToCaught: 2.6, killer: 'hunter' }));
		expect(s).toMatch(/then died to the Hunter 2\.6 s after/);
		expect(s).not.toMatch(/was caught/);
	});
	it('a death while the power was on is a death, not a catch', () => {
		const s = describe(t({ outcome: 'interrupted', endReason: 'died' }, { killer: 'drifter' }));
		expect(s).toBe('Died to the Drifter while the power was still on, so there is no ending to judge.');
	});
	it('mentions a death in every class', () => {
		for (const outcome of ['not-engaged', 'other', 'overstayed', 'timely-retreat', 'early-retreat', 'catch']) {
			const s = describe(t({ outcome, lastChaseEnd: outcome === 'catch' ? 'eat' : outcome === 'overstayed' ? 'open' : 'turn' }, { died: true, caught: false, timeToCaught: null, seen: 0.7 }));
			expect(s, outcome).toMatch(/died 0\.7 s after the power ended/);
		}
	});
	// Built from the round 3 reviewer's trials (kn76yaxr..., kn73kpkh..., kn70r586..., kn7aghy4...).
	it('names the chased ghost and the nearest ghost when their distances differ (stayed too long)', () => {
		const s = describe(t(
			{ outcome: 'overstayed', total: 4.434, turnLeft: -0.56, turnDist: 3.79, endDist: 1.07, lastChaseEnd: 'turn', chaseEndDist: 4.07, chaseGhost: 'hunter', reaction: 0.56 },
			{ minDangerDist: 0.75, nearMiss: true }
		), { endGhost: 'guard' });
		expect(s).toMatch(/still chasing the Hunter when the power ran out/);
		expect(s).toMatch(/4\.1 tiles away, and the nearest ghost was 1\.1 tiles away/);
		expect(s).not.toMatch(/Guard/);
	});
	it('never says "too far to be a danger" when a dangerous ghost was within 5 tiles', () => {
		const s = describe(t(
			{ outcome: 'other', total: 4.341, turnLeft: -0.58, turnDist: 4.5, endDist: 2.6, lastChaseEnd: 'turn', chaseEndDist: 5.06, chaseGhost: 'hunter', reaction: 0.58, eats: [{ t: 1.08, left: 3.26, ghost: 'ambusher' }] },
			{ died: true, caught: false, killer: 'ambusher', minDangerDist: 0.79, seen: 0.93 }
		));
		expect(s).not.toMatch(/too far to be a danger/);
		expect(s).toMatch(/5\.06 tiles off/);
		expect(s).toMatch(/nearest ghost was 2\.6 tiles away/);
		expect(s).toMatch(/died to the Ambusher 0\.9 s after/);
	});
	it('says the same distance once when the chased ghost is the nearest', () => {
		const s = describe(t({ outcome: 'overstayed', turnLeft: null, lastChaseEnd: 'open', endDist: 2.4, chaseEndDist: 2.4, chaseGhost: 'drifter', reaction: 0.3 }));
		expect(s).toMatch(/Drifter when the power ran out, 2\.4 tiles away; moved away/);
		expect(s).not.toMatch(/nearest/);
	});
	it('a death on the frame the power ran out is "as the power ran out", never "0.0 s after"', () => {
		const s = describe(t(
			{ outcome: 'caught', total: 6.574, turnLeft: null, turnDist: null, endDist: 0.56, lastChaseEnd: 'open', chaseEndDist: 0.56, chaseGhost: 'hunter', eats: [{ t: 4.47, left: 2.1, ghost: 'drifter' }] },
			{ died: true, caught: true, killer: 'hunter', timeToCaught: 0, seen: 0, minDangerDist: null }
		));
		expect(s).toMatch(/caught by the Hunter as the power ran out/);
		expect(s).not.toMatch(/0\.0 s/);
		expect(describe(t({ outcome: 'caught', turnLeft: null, lastChaseEnd: 'open', endDist: 1, chaseEndDist: 1 }, { died: true, caught: true, killer: 'hunter', timeToCaught: 0.04 }))).toMatch(/0\.04 s after/);
	});
	it('shows two decimals at the 5-tile line, so "more than 5" never sits next to "5.0"', () => {
		const s = describe(t(
			{ outcome: 'timely-retreat', total: 6.021, turnLeft: 1.68, turnDist: 0.94, endDist: 5.05, chaseEndDist: 10.23, chaseGhost: 'drifter' },
			{ died: true, caught: true, killer: 'hunter', timeToCaught: 0.38, minDangerDist: 0.7, seen: 0.38 }
		));
		expect(s).toMatch(/5\.05 tiles from the nearest dangerous ghost/);
		expect(tilesText(5.05)).toBe('5.05 tiles');
		expect(tilesText(4.96)).toBe('4.96 tiles');
		expect(tilesText(5)).toBe('5.0 tiles');
		expect(tilesText(3.21)).toBe('3.2 tiles');
		expect(tilesText(null)).toBe('-');
		expect(tilesNum(undefined)).toBe('-');
	});
	it('says which kind of "other" it was', () => {
		expect(describe(t({ outcome: 'other', lastChaseEnd: 'open', turnLeft: null, chaseEndDist: 5.1 }))).toMatch(/5\.1 tiles off, too far to be a danger/);
		expect(describe(t({ outcome: 'other', turnLeft: 0.3 }))).toMatch(/could no longer be reached/);
	});
});

group('notCountedReason', () => {
	const r = (patch: Record<string, unknown>) => notCountedReason({ outcome: 'timely-retreat', inRates: true, engaged: true, rulesVersion: RULES_VERSION, endReason: 'expired', after: { cut: null }, ...patch });
	it('is null for a counted decision', () => expect(r({})).toBeNull());
	it('gives a reason for every class that does not count', () => {
		expect(r({ outcome: 'caught', inRates: false, engaged: false })).toMatch(/Not chasing/);
		expect(r({ outcome: 'other', inRates: true })).toMatch(/no decision/);
		expect(r({ outcome: 'catch' })).toMatch(/Ate the ghost/);
		expect(r({ outcome: 'interrupted', endReason: 'died' })).toMatch(/Died while the power was on/);
		expect(r({ rulesVersion: 1 })).toMatch(/older rules/);
		expect(r({ after: { cut: 'quit' }, inRates: false })).toMatch(/run ended/);
	});
});
