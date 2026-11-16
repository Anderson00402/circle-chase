import { describe, expect, it } from 'vitest';
import { createBot } from '../game/engine/bot';
import { createGame, STUDY_CONFIG } from '../game/engine/game';
import { mazeById } from '../game/engine/mazes';
import { CHASE, OVERSTAY_DIST, REACH_SPEED, RULES_VERSION, derive, eligible, gaveUpEarly, isDecision, isLateCatch, rescore } from '#convex/lib/rules.ts';
import type { Scene } from '../game/types';
import { distanceField } from './distance';
import { classify, createTracker } from './tracker';
import { ROW, Sim, playScripted, type Policy } from './testing';
import { OUTCOMES, type TrialMeasures } from './types';

const DT = 1 / 60;
/** Running speed of the hand-made player, tiles per second. */
const V = 4;

/** Position along the corridor over time: straight lines between [time, x] points, held after the last. */
function line(...pts: [number, number][]) {
	return (t: number) => {
		if (t <= pts[0][0]) return pts[0][1];
		for (let i = 1; i < pts.length; i++) {
			const [t0, x0] = pts[i - 1], [t1, x1] = pts[i];
			if (t <= t1) return x0 + ((x1 - x0) * (t - t0)) / (t1 - t0);
		}
		return pts[pts.length - 1][1];
	};
}
/** Runs right from x = 2 at V, turns at time `turn` and runs back to the wall. */
const outAndBack = (turn: number) => line([0, 2], [turn, 2 + V * turn], [turn + (1 + V * turn) / V, 1]);

/**
 * Runs a hand-made power-up on the open corridor of the test maze. `px(mt)` and `gx(mt)` place the
 * player and the hunter (ghost 0) at every moment of moving time, before and after the end. `at(s)`
 * runs once per frame before moving (to eat, die...).
 */
function scenario(opts: {
	total: number;
	px: (mt: number) => number;
	gx: (mt: number) => number;
	at?: (s: Sim) => void;
	seconds?: number;
	setup?: (s: Sim) => void;
	each?: (s: Sim, tracker: ReturnType<typeof createTracker>) => void;
}) {
	const s = new Sim();
	const tracker = createTracker();
	const trials: TrialMeasures[] = [];
	s.player.x = opts.px(0);
	s.ghost(0, opts.gx(0), ROW);
	opts.setup?.(s);
	trials.push(...tracker.onScene(s.scene()));
	s.startPower(opts.total);
	const end = opts.seconds ?? opts.total + 4;
	while (s.t < end) {
		opts.at?.(s);
		s.step(DT, (sim) => {
			sim.player.x = opts.px(sim.mt);
			if (sim.ghosts[0].mode === 'active') sim.ghosts[0].x = opts.gx(sim.mt);
		});
		trials.push(...tracker.onScene(s.scene()));
		opts.each?.(s, tracker);
	}
	trials.push(...tracker.finish());
	return { trials, tracker, sim: s };
}
const eatWhenTouching = (s: Sim) => { if (s.ghosts[0].scared && Math.abs(s.ghosts[0].x - s.player.x) <= 0.5) s.eat(0); };
const dieAfter = (seconds: number) => (s: Sim) => { if (s.power.endReason === 'expired' && s.phase === 'playing' && s.t - s.power.endedAt >= seconds) s.die(0); };

describe('tracker: outcome classes', () => {
	it('timely retreat: runs at a ghost, closest with 1.2 s left, runs back', () => {
		const { trials } = scenario({ total: 5, px: outAndBack(3.8), gx: () => 18.7 });
		expect(trials).toHaveLength(1);
		const t = trials[0];
		expect(t.outcome).toBe('timely-retreat');
		expect(t.rulesVersion).toBe(3);
		expect(t.turnLeft!).toBeCloseTo(1.2, 1);
		expect(t.turnDist!).toBeCloseTo(1.5, 1);
		expect(t.turnAt!).toBeCloseTo(3.8, 1);
		expect(t.turnReachable).toBe(true);
		expect(t.lastChaseEnd).toBe('turn');
		expect(t.chases).toBe(1);
		// The chase began when the ghost came within range and the player's own steps closed 4.5 tiles.
		expect(t.chaseGain!).toBeCloseTo(CHASE.range - 1.5, 1);
		expect(t.chaseGhost).toBe('hunter');
		expect(t.chaseLog).toHaveLength(1);
		expect(t.chaseLog![0]).toMatchObject({ ghost: 'hunter', end: 'turn' });
		// When the power ran out the player was 1.2 s of running farther away.
		expect(t.chaseEndDist!).toBeCloseTo(1.5 + 1.2 * V, 1);
		expect(t.engaged).toBe(true);
		expect(t.inRates).toBe(true);
		expect(t.gaveUpEarly).toBe(false);
		expect(t.endClosing).toBe(false);
		expect(t.reaction).toBeNull();
		// 10 Hz series from start to 3 s after the end.
		expect(t.series.t.length).toBeGreaterThanOrEqual(79);
		expect(t.series.t.length).toBeLessThanOrEqual(82);
		expect(t.series.left[0]).toBeCloseTo(5, 1);
		expect(t.series.left.at(-1)!).toBeLessThan(-2.8);
		expect(t.fps).toBeCloseTo(60, 0);
	});

	it('early retreat in the warning window: wasted power recorded', () => {
		const { trials } = scenario({ total: 6, px: outAndBack(3.4), gx: () => 17.1 });
		const t = trials[0];
		expect(t.outcome).toBe('early-retreat');
		expect(t.turnLeft!).toBeCloseTo(2.6, 1);
		expect(t.turnReachable).toBe(true);
		expect(t.engaged).toBe(true);
		expect(t.gaveUpEarly).toBe(false);
		expect(t.inRates).toBe(true);
		expect(t.wasted).toBe(t.turnLeft);
	});

	it('gave up very early: a reachable ghost dropped before the warning window counts as too early', () => {
		const { trials } = scenario({ total: 7, px: outAndBack(3), gx: () => 16 });
		const t = trials[0];
		expect(t.turnLeft!).toBeCloseTo(4, 1);
		expect(t.turnDist!).toBeCloseTo(2, 1);
		expect(t.engaged).toBe(false);
		expect(t.gaveUpEarly).toBe(true);
		expect(t.outcome).toBe('early-retreat');
		expect(t.inRates).toBe(true);
		expect(isDecision(t)).toBe(true);
		expect(t.wasted).toBe(t.turnLeft);
	});

	it('overstayed: still running at the ghost when the power ends, turns 0.4 s later, survives', () => {
		const px = line([0, 2], [5.4, 2 + V * 5.4], [5.4 + 22.6 / V, 1]);
		const { trials } = scenario({
			total: 5, px,
			// The ghost keeps 1.5 tiles ahead, and follows at that gap once the player runs.
			gx: (t) => (t < 5.4 ? Math.max(20, px(t) + 1.5) : px(t) + 1.5)
		});
		const t = trials[0];
		expect(t.outcome).toBe('overstayed');
		expect(t.engaged).toBe(true);
		expect(t.inRates).toBe(true);
		expect(t.endClosing).toBe(true);
		expect(t.endDist).toBeCloseTo(1.5, 1);
		expect(t.chaseEndDist).toBeCloseTo(1.5, 1);
		expect(t.turnLeft!).toBeCloseTo(-0.4, 1);
		expect(t.reaction!).toBeCloseTo(0.4, 1);
		expect(t.after.died).toBe(false);
		expect(t.after.nearMiss).toBe(true);
		expect(t.after.seen).toBeCloseTo(3, 1);
		expect(t.after.cut).toBeNull();
	});

	it('caught: dies after the end to the ghost that had been scared, never having turned', () => {
		const px = line([0, 2], [9, 2 + V * 9]);
		const { trials } = scenario({ total: 5, px, gx: (t) => Math.max(20, px(t) + 1.5), at: dieAfter(1) });
		const t = trials[0];
		expect(t.outcome).toBe('caught');
		expect(t.endDist!).toBeLessThanOrEqual(5);
		expect(t.lastChaseEnd).toBe('open');
		expect(t.turnLeft).toBeNull(); // never turned away
		expect(t.after.caught).toBe(true);
		expect(t.after.killer).toBe('hunter');
		expect(t.after.timeToCaught!).toBeCloseTo(1, 1);
		expect(t.endClosing).toBe(true);
		expect(t.inRates).toBe(true);
	});

	it('catch, then nothing: a late catch reveals no decision', () => {
		const { trials } = scenario({ total: 5, px: line([0, 2], [9, 2 + V * 9]), gx: () => 20.5, at: eatWhenTouching });
		const t = trials[0];
		expect(t.outcome).toBe('catch');
		expect(t.lastChaseEnd).toBe('eat');
		expect(isLateCatch(t)).toBe(true);
		expect(t.inRates).toBe(true); // eligible, but a catch is not a decision trial
		expect(isDecision(t)).toBe(false);
		expect(t.endClosing).toBe(false);
		expect(t.lateCatch).toBe(true);
		expect(t.eats).toHaveLength(1);
		expect(t.eats[0].left).toBeLessThanOrEqual(1.5);
		expect(t.turnLeft).toBe(t.eats[0].left);
		expect(t.turnDist).toBe(0);
		expect(t.allEatenLeft).toBe(t.eats[0].left);
		expect(t.endDist).toBeNull(); // no ghost turned dangerous
		expect(t.chaseEndDist).toBeNull();
	});

	it('not engaged: the ghost is never within range', () => {
		const px = line([0, 2], [5, 22]);
		const { trials } = scenario({ total: 5, px, gx: (t) => px(t) + 10 });
		expect(trials[0].outcome).toBe('not-engaged');
		expect(trials[0].chases).toBe(0);
		expect(trials[0].lastChaseEnd).toBeNull();
		expect(trials[0].chaseLog).toEqual([]);
		expect(trials[0].series.dist[0]).toBeCloseTo(10, 1);
		expect(trials[0].series.chasing.every((c) => c === 0)).toBe(true);
	});
});

describe('tracker: what counts as a chase', () => {
	it('a blip is not a chase: a step or two toward a ghost in the warning window leaves no trace', () => {
		// The ghost is 4 tiles away. With 1.5 s left the player lunges at it for 0.2 s (0.8 tiles), then
		// runs off. Rules version 2 called this engaged and a decision.
		for (const lunge of [0.05, 0.2, 0.6]) {
			const px = line([0, 12], [3.5, 12], [3.5 + lunge, 12 + V * lunge], [3.5 + lunge + 2, 12 + V * lunge - V * 2]);
			const { trials } = scenario({ total: 5, px, gx: () => 16 });
			const t = trials[0];
			expect(t.chases, `lunge ${lunge}`).toBe(0);
			expect(t.engaged).toBe(false);
			expect(t.outcome).toBe('not-engaged');
			expect(t.inRates).toBe(false);
		}
		// Three tiles of the player's own running make it a chase.
		const px = line([0, 12], [3.5, 12], [4.3, 12 + V * 0.8], [6.3, 12 + V * 0.8 - V * 2]);
		const t = scenario({ total: 5, px, gx: () => 17 }).trials[0];
		expect(t.chases).toBe(1);
		expect(t.chaseGain!).toBeCloseTo(3.2, 1);
		expect(t.turnLeft!).toBeCloseTo(0.7, 1);
		expect(t.outcome).toBe('timely-retreat');
	});

	it('a ghost walking toward a fleeing player is not a chase', () => {
		// The player runs away to the left; the ghost comes after them faster and closes from 6 tiles
		// to 2. The distance shrinks all the way, but never by the player's doing.
		const px = line([0, 30], [5, 30 - V * 5], [9, 30 - V * 5 - 3]);
		const { trials } = scenario({ total: 5, px, gx: (t) => px(t) + Math.max(2, 6 - 0.8 * t) });
		const t = trials[0];
		expect(t.series.dist[0]).toBeCloseTo(6, 1);
		expect(t.series.dist[45]!).toBeLessThan(3);
		expect(t.chases).toBe(0);
		expect(t.engaged).toBe(false);
		expect(t.outcome).toBe('not-engaged');
		// The same for a player who stands still while the ghost walks up to them.
		const still = scenario({ total: 5, px: () => 10, gx: (t) => Math.max(11.5, 16 - t) }).trials[0];
		expect(still.chases).toBe(0);
		expect(still.outcome).toBe('not-engaged');
	});

	it('a ghost running away faster than the player follows is still being chased', () => {
		// The gap grows from 3 to 5.5 tiles, yet every step of the player is toward the ghost.
		const px = line([0, 2], [9, 2 + V * 9]);
		const { trials } = scenario({ total: 5, px, gx: (t) => px(t) + Math.min(5.5, 3 + 0.5 * t), at: dieAfter(2) });
		const t = trials[0];
		expect(t.chases).toBe(1);
		expect(t.lastChaseEnd).toBe('open');
		expect(t.engaged).toBe(true);
	});

	it('no lag at the end: closest with 0.3 s left, then only moving away, is turned away in time', () => {
		// Rules version 2 kept the chase "on" for 0.3 s after the closest moment and stored turn 0.
		const { trials } = scenario({ total: 5, px: outAndBack(4.7), gx: () => 2 + V * 4.7 + 1.2 });
		const t = trials[0];
		expect(t.turnLeft!).toBeCloseTo(0.3, 1);
		expect(t.turnDist!).toBeCloseTo(1.2, 1);
		expect(t.turnReachable).toBe(true); // 1.2 tiles <= 0.3 s x 5.6
		expect(t.outcome).toBe('timely-retreat');
		expect(t.endClosing).toBe(false);
		// Closest with 0.1 s left: that is staying too long, and the turn-away time is 0.1, not 0 or negative.
		const late = scenario({ total: 5, px: outAndBack(4.9), gx: () => 2 + V * 4.9 + 1.2 }).trials[0];
		expect(late.turnLeft!).toBeCloseTo(0.1, 1);
		expect(late.outcome).toBe('overstayed');
		expect(late.endClosing).toBe(true);
		expect(late.reaction).toBe(0);
	});

	it('a player who stops in front of the ghost has turned away where they stopped', () => {
		const { trials } = scenario({ total: 5, px: line([0, 2], [3.5, 16], [9, 16]), gx: () => 18 });
		const t = trials[0];
		expect(t.lastChaseEnd).toBe('turn');
		expect(t.turnLeft!).toBeCloseTo(1.5, 1);
		expect(t.outcome).toBe('timely-retreat');
	});

	it('an eat ends a chase and cannot start one: eating, then turning back at once, is a catch', () => {
		// Ghost 1 stands 4 tiles behind ghost 0, in line. The player eats ghost 0 with about 1.2 s left
		// and runs back. Rules version 2 opened a chase on ghost 1 on the eat frame and stored a turn-away.
		const turn = 3.8;
		const { trials } = scenario({
			total: 5, px: outAndBack(turn), gx: () => 2 + V * turn + 0.4, at: eatWhenTouching,
			setup: (s) => s.ghost(1, 2 + V * turn + 4.4, ROW)
		});
		const t = trials[0];
		expect(t.eats).toHaveLength(1);
		expect(t.eats[0].left).toBeCloseTo(1.2, 1);
		expect(t.chases).toBe(1);
		expect(t.lastChaseEnd).toBe('eat');
		expect(t.outcome).toBe('catch');
		expect(t.turnDist).toBe(0);
	});

	it('eat, then a new chase of the next ghost that is given up in time: the second chase decides', () => {
		const s = new Sim();
		const tracker = createTracker();
		const trials: TrialMeasures[] = [];
		s.player.x = 2;
		s.ghost(0, 8, ROW); s.ghost(1, 23, ROW);
		tracker.onScene(s.scene());
		s.startPower(6);
		// Runs right, eats ghost 0 on the way, keeps on toward ghost 1 and turns 2.6 tiles short of it with 1.4 s left.
		let dir = 1;
		while (s.t < 10) {
			if (s.ghosts[0].scared && s.ghosts[0].x - s.player.x <= 0.5) s.eat(0);
			s.step(DT, (sim, dt) => {
				if (sim.power.left > 0 && sim.power.left <= 1.4) dir = -1;
				sim.player.x = Math.max(1, sim.player.x + dir * V * dt);
			});
			trials.push(...tracker.onScene(s.scene()));
		}
		const t = trials[0];
		expect(t.eats).toHaveLength(1);
		expect(t.chases).toBe(2);
		expect(t.chaseLog!.map((c) => c.end)).toEqual(['eat', 'turn']);
		expect(t.chaseGhost).toBe('ambusher');
		// The second chase only counts what the player ran after the eat.
		expect(t.chaseLog![1].from).toBeGreaterThanOrEqual(t.eats[0].t - 0.02);
		expect(t.lastChaseEnd).toBe('turn');
		expect(t.turnLeft!).toBeCloseTo(1.4, 1);
		expect(t.outcome).toBe('timely-retreat');
	});

	it('still chasing at the end but far from every ghost: not "stayed too long"', () => {
		// The ghost keeps 5.5 tiles ahead of a player who runs after it through the end.
		const px = line([0, 2], [5.4, 2 + V * 5.4], [5.4 + 22.6 / V, 1]);
		const { trials } = scenario({ total: 5, px, gx: (t) => px(Math.min(t, 5.4)) + 5.5 });
		const t = trials[0];
		expect(t.lastChaseEnd).toBe('turn');
		expect(t.turnLeft!).toBeLessThan(0);
		expect(t.endClosing).toBe(true);
		expect(t.chaseEndDist!).toBeCloseTo(5.5, 1);
		expect(t.chaseEndDist!).toBeGreaterThan(OVERSTAY_DIST);
		expect(t.outcome).toBe('other');
		expect(isDecision(t)).toBe(false);
	});

	it('turned away in the window from a ghost that was out of reach: no decision', () => {
		// 0.5 s left and the ghost 4 tiles away: the player could cover 2.8. (The ghost was walking
		// away slower than the player ran, so the gap had been closing.)
		const px = outAndBack(4.5);
		const { trials } = scenario({ total: 5, px, gx: (t) => px(Math.min(t, 4.5)) + 4 + Math.max(0, 4.5 - t) });
		const t = trials[0];
		expect(t.turnLeft!).toBeCloseTo(0.5, 1);
		expect(t.turnDist!).toBeCloseTo(4, 1);
		expect(t.turnDist!).toBeGreaterThan(t.turnLeft! * REACH_SPEED);
		expect(t.turnReachable).toBe(false);
		expect(t.engaged).toBe(true);
		expect(t.outcome).toBe('other');
		expect(isDecision(t)).toBe(false);
	});

	it('a ghost out of range is not chased, however long the player runs toward it', () => {
		const px = line([0, 2], [5, 22], [9, 6]);
		const { trials } = scenario({ total: 5, px, gx: (t) => px(Math.min(t, 5)) + 6.5 });
		expect(trials[0].chases).toBe(0);
	});

	it('path distance wraps through a tunnel, and running through it at a ghost is a chase', () => {
		const plaza = mazeById('plaza');
		const row = 9; // the tunnel row: open at both edges
		expect(distanceField(plaza, 1, row).to(23, row)).toBeCloseTo(3, 5);
		expect(distanceField(plaza, 0.4, row).to(24.5, row)).toBeCloseTo(0.9, 5);
		expect(distanceField(plaza, -0.4, row).to(23, row)).toBeCloseTo(1.6, 5);
		expect(distanceField(plaza, 24.6, row).to(23, row)).toBeCloseTo(1.6, 5);

		const s = new Sim();
		s.maze = plaza;
		s.dots = plaza.dotsInit.slice();
		const tracker = createTracker();
		const trials: TrialMeasures[] = [];
		s.player = { x: 4, y: row };
		s.ghost(0, 21, row); // 8 tiles away through the tunnel, 17 the long way round
		tracker.onScene(s.scene());
		s.startPower(5);
		// Runs left through the tunnel at the ghost; turns back on the far side, 0.8 tiles short of it,
		// with 3.2 s left, and runs back out through the tunnel.
		let x = 4;
		while (s.t < 9) {
			s.step(DT, (sim, dt) => {
				x += (sim.power.left > 3.2 ? -V : V) * dt;
				// The engine keeps x within the board: just past the left edge it continues from the right.
				sim.player.x = ((((x + 0.5) % plaza.W) + plaza.W) % plaza.W) - 0.5;
			});
			trials.push(...tracker.onScene(s.scene()));
		}
		const t = trials[0];
		expect(t.series.dist[0]).toBeCloseTo(8, 0);
		expect(t.chases).toBe(1);
		// The distance fell and rose smoothly across the edge, both ways: no jump in the series.
		for (let i = 1; i < 36; i++) expect(Math.abs(t.series.dist[i]! - t.series.dist[i - 1]!)).toBeLessThan(0.5);
		expect(Math.min(...t.series.dist.slice(0, 36).map((d) => d!))).toBeCloseTo(0.8, 0);
		expect(t.chaseGain!).toBeCloseTo(CHASE.range - 0.8, 0); // from 6 tiles, where the chase can start, down to 0.8
		expect(t.turnLeft!).toBeCloseTo(3.2, 1);
		expect(t.turnDist!).toBeCloseTo(0.8, 1);
		expect(t.lastChaseEnd).toBe('turn');
		expect(t.outcome).toBe('early-retreat');
	});
});

describe('rules: classify', () => {
	const base = {
		endReason: 'expired', endDist: 8 as number | null, turnLeft: 1 as number | null, turnDist: 2 as number | null, engaged: true,
		lastChaseEnd: 'turn' as 'turn' | 'eat' | 'open' | null, chaseEndDist: 6 as number | null, after: { caught: false, cut: null as 'power' | 'clear' | 'quit' | null }
	};
	const caught = { caught: true, cut: null };

	it('follows the order in STUDY.md', () => {
		// Caught needs the death and being within 5 tiles of a ghost that just turned dangerous.
		expect(classify({ ...base, after: caught, endDist: 5 })).toBe('caught');
		expect(classify({ ...base, after: caught, endDist: 5.1 })).toBe('timely-retreat');
		expect(classify({ ...base, after: caught, endDist: 2, lastChaseEnd: 'eat' })).toBe('caught');
		// The last chase ended in an eat: a catch, whatever the time left, when it was in the window.
		expect(classify({ ...base, lastChaseEnd: 'eat', turnLeft: 2.06, turnDist: 0 })).toBe('catch');
		expect(classify({ ...base, lastChaseEnd: 'eat', turnLeft: 0.4, turnDist: 0 })).toBe('catch');
		expect(classify({ ...base, engaged: false, lastChaseEnd: 'eat', turnLeft: 5, turnDist: 0 })).toBe('not-engaged');
		// Still running at the end: never turned, turned after the end, or with less than 0.2 s left...
		expect(classify({ ...base, lastChaseEnd: 'open', turnLeft: null, turnDist: null, chaseEndDist: 2 })).toBe('overstayed');
		expect(classify({ ...base, turnLeft: -0.4, chaseEndDist: 2 })).toBe('overstayed');
		expect(classify({ ...base, turnLeft: 0.19, chaseEndDist: 5 })).toBe('overstayed');
		// ...and only within 5 tiles of the ghost that was chased.
		expect(classify({ ...base, turnLeft: 0.19, chaseEndDist: 5.01 })).toBe('other');
		expect(classify({ ...base, lastChaseEnd: 'open', turnLeft: null, turnDist: null, chaseEndDist: null })).toBe('other');
		expect(classify({ ...base, lastChaseEnd: 'open', turnLeft: null, turnDist: null, chaseEndDist: 7, endDist: 12, after: caught })).toBe('other');
		// Turned in the window, or earlier, from a ghost in reach.
		expect(classify({ ...base, turnLeft: 0.2, turnDist: 1.1 })).toBe('timely-retreat');
		expect(classify({ ...base, turnLeft: 0.2, turnDist: 1.2 })).toBe('other');
		expect(classify({ ...base, turnLeft: 2 })).toBe('timely-retreat');
		expect(classify({ ...base, turnLeft: 2.01 })).toBe('early-retreat');
		expect(classify({ ...base, turnLeft: 1, turnDist: 5.7 })).toBe('other');
		// Before the warning window: a reachable ghost given up is too early, the rest is not engaged.
		expect(classify({ ...base, engaged: false, turnLeft: 4 })).toBe('early-retreat');
		expect(classify({ ...base, engaged: false, lastChaseEnd: null, turnLeft: null, turnDist: null })).toBe('not-engaged');
		expect(classify({ ...base, endReason: 'refreshed' })).toBe('interrupted');
		expect(classify({ ...base, endReason: 'died', after: caught, endDist: 1 })).toBe('interrupted');
	});

	it('eligibility does not depend on how the aftermath went', () => {
		expect(eligible(base)).toBe(true);
		expect(eligible({ ...base, after: caught, endDist: 2 })).toBe(true);
		expect(eligible({ ...base, after: { caught: false, cut: 'quit' } })).toBe(false);
		expect(eligible({ ...base, after: { caught: false, cut: 'power' } })).toBe(true);
		expect(eligible({ ...base, endReason: 'quit' })).toBe(false);
		// Not engaged: only a reachable ghost given up before the window makes the trial count.
		expect(gaveUpEarly({ ...base, engaged: false, turnLeft: 4 })).toBe(true);
		expect(eligible({ ...base, engaged: false, turnLeft: 4 })).toBe(true);
		expect(eligible({ ...base, engaged: false, lastChaseEnd: 'eat', turnLeft: 5, turnDist: 0 })).toBe(false);
		expect(eligible({ ...base, engaged: false, lastChaseEnd: null, turnLeft: null, turnDist: null })).toBe(false);
		// Caught without a chase to judge: recorded as caught, outside the rates.
		const walkedInto = { ...base, engaged: false, lastChaseEnd: null, turnLeft: null, turnDist: null, after: caught, endDist: 1 };
		expect(derive(walkedInto)).toMatchObject({ outcome: 'caught', inRates: false });
	});

	it('rescore recomputes rows of this version and leaves older rows on their version', () => {
		const row = { ...base, outcome: 'other', wasted: null, rulesVersion: 3 };
		expect(rescore(row)).toEqual({ outcome: 'timely-retreat', rulesVersion: RULES_VERSION, wasted: null, inRates: true, gaveUpEarly: false });
		expect(rescore({ ...row, engaged: false, turnLeft: 4 })).toMatchObject({ outcome: 'early-retreat', wasted: 4, inRates: true, gaveUpEarly: true });
		// A rules version 2 row has no `chaseEndDist`: it keeps its class and its version, and is in no rate.
		const { chaseEndDist: _c, ...v2 } = { ...row, outcome: 'overstayed', rulesVersion: 2 };
		expect(rescore(v2)).toEqual({ outcome: 'overstayed', rulesVersion: 2, wasted: null });
		expect(isDecision({ ...v2, inRates: true, ...rescore(v2) })).toBe(false);
		// A rules version 1 row has no `lastChaseEnd` either.
		const { lastChaseEnd: _l, ...v1 } = { ...v2, outcome: 'late-catch', rulesVersion: undefined };
		expect(rescore(v1)).toEqual({ outcome: 'late-catch', rulesVersion: 1, wasted: null });
	});
});

describe('tracker: edge cases', () => {
	const far = (total: number, extra: Partial<Parameters<typeof scenario>[0]> = {}) =>
		scenario({ total, px: () => 5, gx: () => 15, ...extra });

	it('second power dot during a power-up: refreshed, then a new trial', () => {
		const { trials } = far(6, { seconds: 16, at: (s) => { if (s.power.serial === 1 && s.mt >= 3) s.startPower(5); } });
		expect(trials).toHaveLength(2);
		expect(trials[0].endReason).toBe('refreshed');
		expect(trials[0].outcome).toBe('interrupted');
		expect(trials[0].leftAtEnd).toBeCloseTo(3, 1);
		expect(trials[0].inRates).toBe(false);
		expect(trials[1].serial).toBe(2);
		expect(trials[1].endReason).toBe('expired');
	});

	it('a power dot during the aftermath cuts it short', () => {
		const { trials } = far(4, { seconds: 14, at: (s) => { if (s.power.serial === 1 && s.power.endReason === 'expired' && s.t - s.power.endedAt >= 1) s.startPower(4); } });
		expect(trials[0].endReason).toBe('expired');
		expect(trials[0].after.seen).toBeCloseTo(1, 1);
		expect(trials[0].after.cut).toBe('power');
		expect(trials[1].serial).toBe(2);
	});

	it('death during the power: interrupted, diedDuring', () => {
		const { trials } = far(6, {
			setup: (s) => s.ghost(1, 30, 6), // out of the pen but not scared when the power starts
			at: (s) => { if (s.mt >= 2 && s.phase === 'playing') { s.ghosts[1].scared = false; s.die(1); } }
		});
		expect(trials).toHaveLength(1);
		expect(trials[0].endReason).toBe('died');
		expect(trials[0].diedDuring).toBe(true);
		expect(trials[0].outcome).toBe('interrupted');
		expect(trials[0].leftAtEnd).toBeCloseTo(4, 1);
	});

	it('level clear during the power: interrupted with endReason cleared', () => {
		const { trials } = far(6, { at: (s) => { if (s.mt >= 2 && s.phase === 'playing') { s.endPower('cleared'); s.phase = 'clear'; } } });
		expect(trials[0].endReason).toBe('cleared');
		expect(trials[0].outcome).toBe('interrupted');
	});

	it('all scared ghosts eaten early: nothing left to chase', () => {
		const { trials } = scenario({ total: 6, px: line([0, 2], [9, 38]), gx: () => 6, at: eatWhenTouching });
		const t = trials[0];
		expect(t.allEatenLeft!).toBeGreaterThan(4);
		expect(t.turnLeft).toBe(t.allEatenLeft);
		expect(t.turnReachable).toBeNull();
		expect(t.engaged).toBe(false);
		expect(t.gaveUpEarly).toBe(false);
		expect(t.outcome).toBe('not-engaged');
	});

	it('eating the last ghost inside the warning window, not late: engaged, a catch', () => {
		const { trials } = scenario({ total: 6, px: line([0, 2], [9, 38]), gx: () => 17, at: eatWhenTouching });
		const t = trials[0];
		expect(t.eats[0].left).toBeGreaterThan(1.5);
		expect(t.eats[0].left).toBeLessThan(3);
		expect(t.engaged).toBe(true);
		expect(t.outcome).toBe('catch');
		expect(isLateCatch(t)).toBe(false);
	});

	it('no ghost out of the pen: nothing scared, not engaged', () => {
		const { trials } = far(5, { setup: (s) => { s.ghosts[0].mode = 'waiting'; s.ghosts[0].x = 20; s.ghosts[0].y = 4; } });
		expect(trials[0].scaredAtStart).toBe(0);
		expect(trials[0].series.dist.every((d) => d === null)).toBe(true);
		expect(trials[0].outcome).toBe('not-engaged');
	});

	it('the freeze after an eat leaves no gap in the series', () => {
		const { trials } = scenario({
			total: 7, px: line([0, 2], [9, 38]), gx: () => 8, at: eatWhenTouching, setup: (s) => s.ghost(1, 30, ROW)
		});
		const t = trials[0];
		expect(t.eats).toHaveLength(1);
		// Game time stands still during the freeze: the series has no gap and no repeats there.
		for (let i = 1; i < t.series.t.length; i++) {
			expect(t.series.t[i] - t.series.t[i - 1]).toBeLessThan(0.12);
			expect(t.series.t[i]).toBeGreaterThan(t.series.t[i - 1]);
		}
	});

	it('pause and repeated frames change nothing', () => {
		const s = new Sim();
		const tracker = createTracker();
		s.ghost(0, 12, ROW);
		tracker.onScene(s.scene());
		s.startPower(5);
		tracker.onScene(s.scene());
		for (let i = 0; i < 30; i++) { s.step(DT); tracker.onScene(s.scene()); }
		const frames = 31;
		// The game sends nothing while paused; a redraw of the same moment is ignored.
		for (let i = 0; i < 10; i++) tracker.onScene(s.scene());
		const [t] = tracker.finish();
		expect(t.frames).toBe(frames);
		expect(t.endReason).toBe('quit');
		expect(t.outcome).toBe('interrupted');
	});

	it('leaving while the power is on: closed at the last frame seen, with the power left then', () => {
		// Rules version 2 stored endedAt -1 here (an "end" before the start) and so no clip.
		const s = new Sim();
		const tracker = createTracker();
		s.player.x = 2;
		s.ghost(0, 18.5, ROW);
		for (let i = 0; i < 120; i++) { s.step(DT); tracker.onScene(s.scene()); } // 2 s of play first
		s.startPower(6);
		while (s.power.left > 2.5) { s.step(DT, (sim, dt) => { sim.player.x += V * dt; }); tracker.onScene(s.scene()); }
		const [t] = tracker.finish();
		expect(t.endReason).toBe('quit');
		expect(t.outcome).toBe('interrupted');
		expect(t.startedAt).toBeCloseTo(2, 1);
		expect(t.endedAt).toBeCloseTo(s.t, 2);
		expect(t.endedAt).toBeGreaterThan(t.startedAt);
		expect(t.leftAtEnd).toBeCloseTo(2.5, 1);
		expect(t.endedAt - t.startedAt).toBeCloseTo(t.total - t.leftAtEnd, 1);
		expect(t.inRates).toBe(false);
		// The chase under way reached into the warning window, so the trial is engaged and gets a clip.
		expect(t.lastChaseEnd).toBe('open');
		expect(t.engaged).toBe(true);
		// Leaving before the window: the same, but not engaged.
		const s2 = new Sim();
		const tr2 = createTracker();
		s2.player.x = 2;
		s2.ghost(0, 12, ROW);
		tr2.onScene(s2.scene());
		s2.startPower(8);
		while (s2.power.left > 5) { s2.step(DT, (sim, dt) => { sim.player.x = Math.min(11, sim.player.x + V * dt); }); tr2.onScene(s2.scene()); }
		const [u] = tr2.finish();
		expect(u.endedAt).toBeCloseTo(3, 1);
		expect(u.leftAtEnd).toBeCloseTo(5, 1);
		expect(u.engaged).toBe(false);
	});

	it('leaving during the aftermath: kept, classified, but not in the rates', () => {
		const s = new Sim();
		const tracker = createTracker();
		s.player.x = 2;
		s.ghost(0, 20.5, ROW);
		tracker.onScene(s.scene());
		s.startPower(4);
		// Chase toward the ghost so the trial is engaged, then leave 1 s after the end.
		while (!(s.power.endReason === 'expired' && s.t - s.power.endedAt >= 1)) {
			s.step(DT, (sim, dt) => { if (sim.power.left > 0) sim.player.x += V * dt; });
			tracker.onScene(s.scene());
		}
		const [t] = tracker.finish();
		expect(t.endReason).toBe('expired');
		expect(t.engaged).toBe(true);
		expect(t.after.cut).toBe('quit');
		expect(t.after.seen).toBeCloseTo(1, 1);
		expect(t.inRates).toBe(false);
	});

	it('game over or a new game closes a running power-up as quit', () => {
		const s = new Sim();
		const tracker = createTracker();
		s.ghost(0, 12, ROW);
		tracker.onScene(s.scene());
		s.startPower(5);
		for (let i = 0; i < 60; i++) { s.step(DT); tracker.onScene(s.scene()); }
		const fresh = new Sim();
		const out = tracker.onScene(fresh.scene()); // time went back: a new game
		expect(out).toHaveLength(1);
		expect(out[0].endReason).toBe('quit');
		expect(out[0].endedAt).toBeCloseTo(1, 1);
		expect(tracker.live.state).toBe('idle');
	});
});

describe('tracker: the live readout never gives the time left away', () => {
	it('carries no clock, no power length and no judgement while the power is on; the outcome only after the trial closed', () => {
		// Two power-ups that differ only in length and in when the player turns: until the first of
		// them ends, the readouts must be identical frame by frame.
		const runs = [5, 7].map((total) => {
			const seen: { t: number; live: ReturnType<typeof createTracker>['live'] }[] = [];
			const r = scenario({
				// The ghost keeps 2.5 tiles ahead while the player runs at it, and stops when they turn.
				total, px: outAndBack(total - 1.2), gx: (t) => 2 + V * Math.min(t, total - 1.2) + 2.5,
				each: (s, tracker) => seen.push({ t: s.t, live: { ...tracker.live } })
			});
			return { seen, trial: r.trials[0], total };
		});
		const [a, b] = runs;
		expect(a.trial.outcome).toBe('timely-retreat');
		for (const run of runs) {
			for (const { t, live } of run.seen) {
				if (t < run.total - 1e-6) {
					expect(live.state).toBe('power');
					expect(live.left).toBe(0);
					expect(live.total).toBe(0);
					expect(live.engaged).toBe(false);
					expect(live.guess).toBeNull();
				} else if (live.state === 'after') {
					// The power is over: the seconds since are no secret, but there is still no guess.
					expect(live.left).toBeLessThanOrEqual(0);
					expect(live.guess).toBeNull();
					expect(live.engaged).toBe(false);
				}
			}
		}
		// Same play up to 3.7 s (the shorter one turns at 3.8): nothing tells the two apart.
		const upTo = a.seen.filter((x) => x.t < 3.7).length;
		expect(upTo).toBeGreaterThan(200);
		for (let i = 0; i < upTo; i++) expect(a.seen[i].live).toEqual(b.seen[i].live);
		// Once closed, the readout is idle and carries the outcome.
		const last = a.seen.at(-1)!.live;
		expect(last.state).toBe('idle');
		expect(last.guess).toBe('timely-retreat');
		expect(last.engaged).toBe(true);
	});

	it('says whether the player is going after a ghost, and how far the nearest one is', () => {
		const s = new Sim();
		const tracker = createTracker();
		s.player.x = 2;
		s.ghost(0, 14, ROW);
		tracker.onScene(s.scene());
		expect(tracker.live.guess).toBeNull();
		s.startPower(5);
		for (let i = 0; i < 150; i++) { s.step(DT, (sim, dt) => { sim.player.x += V * dt; }); tracker.onScene(s.scene()); }
		expect(tracker.live.state).toBe('power');
		expect(tracker.live.nearest?.ghost).toBe('hunter');
		expect(tracker.live.nearest!.dist).toBeCloseTo(2, 1);
		expect(tracker.live.chasing).toBe(true);
	});
});

describe('tracker: scripted games on the real engine', () => {
	function play(policy: Policy, seed: number, seconds = 150) {
		const tracker = createTracker();
		const trials: TrialMeasures[] = [];
		playScripted({ ...STUDY_CONFIG, seed }, seconds, policy, (scene) => trials.push(...tracker.onScene(scene)));
		trials.push(...tracker.finish());
		return trials;
	}

	it('produces sane trials for every policy', () => {
		const all: TrialMeasures[] = [];
		for (const [policy, seed] of [['chase', 1], ['chase', 2], [{ retreatAt: 1.2 }, 3], [{ retreatAt: 3 }, 4], ['ignore', 5]] as [Policy, number][]) {
			const trials = play(policy, seed);
			expect(trials.length, `${JSON.stringify(policy)} seed ${seed}`).toBeGreaterThan(2);
			all.push(...trials);
		}
		for (const t of all) {
			expect(OUTCOMES).toContain(t.outcome);
			expect(t.total).toBeGreaterThanOrEqual(4);
			expect(t.total).toBeLessThanOrEqual(8);
			expect(t.fps).toBeGreaterThan(55);
			expect(t.endedAt).toBeGreaterThan(t.startedAt);
			if (t.endReason === 'expired') {
				expect(t.series.t.length).toBeGreaterThan((t.total + t.after.seen) * 10 - 3);
				expect(t.series.t.length).toBeLessThan((t.total + 3) * 10 + 8);
			}
			if (t.outcome === 'caught') expect(t.after.caught && t.endDist! <= 5).toBe(true);
			if (t.inRates) expect((t.engaged || t.gaveUpEarly) && t.endReason === 'expired').toBe(true);
			// Stored classes are what the shared rules give for the stored measures.
			expect(derive(t)).toEqual({ outcome: t.outcome, inRates: t.inRates, wasted: t.wasted, gaveUpEarly: t.gaveUpEarly });
			if (t.lastChaseEnd === 'eat' && t.engaged && t.endReason === 'expired' && t.outcome !== 'caught') expect(t.outcome).toBe('catch');
			for (let i = 1; i < t.series.t.length; i++) expect(t.series.t[i]).toBeGreaterThan(t.series.t[i - 1]);
		}
		const counts: Record<string, number> = {};
		for (const t of all) counts[t.outcome] = (counts[t.outcome] ?? 0) + 1;
		// The chasers produce catches; the ignorer produces unengaged trials.
		expect((counts['catch'] ?? 0) + (counts['caught'] ?? 0) + (counts['overstayed'] ?? 0)).toBeGreaterThan(0);
		expect(counts['not-engaged'] ?? 0).toBeGreaterThan(0);
	}, 60_000);

	it('is deterministic for a seed', () => {
		const a = play('chase', 9, 60), b = play('chase', 9, 60);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	}, 30_000);
});

/**
 * Property checks. The engine bot plays study games; every scene is kept, and each decision trial
 * is checked against the definition in STUDY.md by going back to the scenes, with code that shares
 * nothing with the tracker but the distance function.
 */
describe('tracker: every decision trial has a last chase that satisfies the definition', () => {
	interface Kept { t: number; scene: Scene; moving: boolean }

	function playBot(seed: number, noise: number, caution: number, seconds: number) {
		const game = createGame({ ...STUDY_CONFIG, seed });
		const bot = createBot(game, { seed, skill: 0.9, awarenessNoise: noise, caution, reaction: 0.4 });
		const tracker = createTracker();
		const kept: Kept[] = [];
		const trials: TrialMeasures[] = [];
		let prevLeft = -1, prevT = -1;
		for (let i = 1; i <= seconds * 120; i++) {
			bot.step();
			game.update(1 / 120);
			if (i % 2) continue;
			const scene = game.scene();
			const f = scene.frame;
			// Moving: the board is live and the clocks ran (not the freeze after an eat).
			const moving = f.phase === 'playing' && f.t > prevT && !(f.power.left > 0 && f.power.left === prevLeft);
			kept.push({ t: f.t, scene: { ...scene, dots: scene.dots }, moving });
			prevLeft = f.power.left; prevT = f.t;
			trials.push(...tracker.onScene(scene));
		}
		return { trials, kept };
	}

	/** Path distance from the player to one ghost in a kept scene. */
	const distTo = (k: Kept, id: string, from = k) => {
		const g = k.scene.frame.ghosts.find((x) => x.id === id)!;
		const p = from.scene.frame.player;
		return distanceField(k.scene.maze, p.x, p.y).to(g.x, g.y);
	};

	it('holds over bot games with good and poor timing', () => {
		let decisions = 0, turns = 0, overstays = 0, early = 0;
		const classes: Record<string, number> = {};
		for (const [seed, noise, caution] of [[3, 0, 1], [8, 1.5, 0.6], [21, 2.5, 0.2], [34, 2.5, 1], [55, 0.5, -0.5], [89, 1, 0.3], [144, 3, 0], [233, 0, 0.5]] as const) {
			const { trials, kept } = playBot(seed, noise, caution, 180);
			for (const t of trials) {
				classes[t.outcome] = (classes[t.outcome] ?? 0) + 1;
				expect(derive(t)).toEqual({ outcome: t.outcome, inRates: t.inRates, wasted: t.wasted, gaveUpEarly: t.gaveUpEarly });
				if (!isDecision(t)) continue;
				decisions++;
				const why = `seed ${seed} serial ${t.serial} ${t.outcome}`;
				expect(t.endReason, why).toBe('expired');
				if (t.outcome === 'caught') {
					expect(t.after.caught && t.after.timeToCaught! <= 3 && t.endDist! <= 5, why).toBe(true);
					continue;
				}
				// A turn-away or a chase still running: there is a last chase, and it is the log's latest.
				const last = t.chaseLog!.reduce((a, c) => {
					const ka = a.end === 'open' ? Infinity : a.at, kc = c.end === 'open' ? Infinity : c.at;
					return kc > ka || (kc === ka && c.dist < a.dist) ? c : a;
				});
				expect(last.end, why).not.toBe('eat');
				expect(last.ghost, why).toBe(t.chaseGhost);
				expect(last.gain, why).toBeGreaterThanOrEqual(CHASE.minGain);
				// No ghost was eaten after the chase's turn-away.
				for (const e of t.eats) expect(e.t, why).toBeLessThanOrEqual(last.at + 1e-6);

				const i0 = kept.findIndex((k) => k.t >= t.startedAt + last.from - 1e-6);
				const i1 = kept.findIndex((k) => k.t >= t.startedAt + last.at - 0.006);
				// 1. Sustained and by the player's own steps: from the first step to the closest point the
				// player's steps alone closed the stored gain, and that took a third of a second at least.
				let own = 0;
				for (let i = Math.max(1, i0); i <= i1; i++) {
					if (!kept[i].moving) continue;
					own += distTo(kept[i], last.ghost) - distTo(kept[i], last.ghost, kept[i - 1]);
					// The ghost was a target and in range all along (while the power was on).
					const g = kept[i].scene.frame.ghosts.find((x) => x.id === last.ghost)!;
					if (kept[i].scene.frame.power.left > 0) {
						expect(g.scared && g.mode === 'active', why).toBe(true);
						expect(distTo(kept[i], last.ghost), why).toBeLessThanOrEqual(CHASE.range + 1e-6);
					}
				}
				expect(-own, why).toBeGreaterThanOrEqual(CHASE.minGain - 0.2);
				expect(Math.abs(-own - last.gain), why).toBeLessThan(0.25);
				expect(last.at - last.from, why).toBeGreaterThan(0.3);
				// 2. The stored distance at the turn-away is the distance to that ghost at that frame.
				expect(Math.abs(distTo(kept[i1], last.ghost) - last.dist), why).toBeLessThan(0.15);

				if (last.end === 'turn') {
					turns++;
					// 3. The turn-away is the closest point: afterwards the player's own steps never bring
					// them closer again before they are a full tile back, or have stopped for half a second.
					let back = 0, still = 0;
					for (let i = i1 + 1; i < kept.length && back < CHASE.backoff && still < CHASE.idle; i++) {
						if (!kept[i].moving) continue;
						const g = kept[i].scene.frame.ghosts.find((x) => x.id === last.ghost)!;
						if (g.mode !== 'active') break;
						back += distTo(kept[i], last.ghost) - distTo(kept[i], last.ghost, kept[i - 1]);
						still += kept[i].t - kept[i - 1].t;
						expect(back, why).toBeGreaterThan(-1e-6);
					}
				}
				if (t.outcome === 'timely-retreat' || t.outcome === 'early-retreat') {
					// 4. Retreats: turned with time left from a ghost within reach.
					expect(t.turnLeft!, why).toBeGreaterThanOrEqual(0.2);
					expect(t.turnDist!, why).toBeLessThanOrEqual(t.turnLeft! * REACH_SPEED);
					expect(t.turnLeft! <= 2, why).toBe(t.outcome === 'timely-retreat');
					expect(t.gaveUpEarly, why).toBe(t.turnLeft! > Math.min(3, t.total));
					if (t.gaveUpEarly) early++;
				} else {
					// 5. Stayed too long: the chase was running at the end, within 5 tiles of its ghost.
					overstays++;
					expect(t.outcome, why).toBe('overstayed');
					expect(last.end === 'open' || last.left < 0.2, why).toBe(true);
					const ie = kept.findIndex((k) => k.scene.frame.power.serial === t.serial && k.scene.frame.power.endReason === 'expired');
					expect(Math.abs(distTo(kept[ie], last.ghost) - t.chaseEndDist!), why).toBeLessThan(0.15);
					expect(t.chaseEndDist!, why).toBeLessThanOrEqual(OVERSTAY_DIST);
				}
			}
		}
		// The games must actually exercise the classes.
		expect(decisions).toBeGreaterThan(25);
		expect(turns).toBeGreaterThan(15);
		expect(overstays).toBeGreaterThan(2);
		expect(classes['catch'] ?? 0).toBeGreaterThan(5);
		console.log('bot property check', { decisions, turns, overstays, gaveUpEarly: early, classes });
	}, 120_000);
});
