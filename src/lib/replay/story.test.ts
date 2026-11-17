import { describe as group, expect, it } from 'vitest';
import { describe, type StoryTrial } from './story';
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
