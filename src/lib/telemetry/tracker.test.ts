import { describe, expect, it } from 'vitest';
import { STUDY_CONFIG } from '../game/engine/game';
import { classify, createTracker } from './tracker';
import { ROW, Sim, playScripted, type Policy } from './testing';
import { OUTCOMES, type TrialMeasures } from './types';

const DT = 1 / 60;

/**
 * Runs a hand-made power-up. The player walks along the open corridor of the test maze; `gap(mt)` places
 * the hunter (ghost 0) that many tiles to the player's right while the power is on. `after(s, dt)`
 * moves both once it has run out. `at(s)` runs once per frame before moving (to eat, die...).
 */
function scenario(opts: {
	total: number;
	gap: (mt: number) => number;
	after?: (s: Sim, dt: number) => void;
	at?: (s: Sim) => void;
	seconds?: number;
	walk?: number;
	setup?: (s: Sim) => void;
}) {
	const s = new Sim();
	const tracker = createTracker();
	const trials: TrialMeasures[] = [];
	s.ghost(0, s.player.x + opts.gap(0), ROW);
	opts.setup?.(s);
	trials.push(...tracker.onScene(s.scene()));
	s.startPower(opts.total);
	const walk = opts.walk ?? 0.5;
	const x0 = s.player.x;
	const end = opts.seconds ?? opts.total + 4;
	while (s.t < end) {
		opts.at?.(s);
		s.step(DT, (sim, dt) => {
			if (sim.power.left > 0 || sim.power.endReason !== 'expired') {
				sim.player.x = x0 + walk * sim.mt;
				if (sim.ghosts[0].mode === 'active') sim.ghosts[0].x = sim.player.x + opts.gap(sim.mt);
			} else opts.after?.(sim, dt);
		});
		trials.push(...tracker.onScene(s.scene()));
	}
	trials.push(...tracker.finish());
	return { trials, tracker, sim: s };
}

describe('tracker: outcome classes', () => {
	it('overstayed: closing in at the end, survives', () => {
		let phase = 0;
		const { trials } = scenario({
			total: 5,
			gap: (mt) => Math.max(1.5, 6 - 0.9 * mt),
			after: (s, dt) => {
				phase += dt;
				// Keep walking at the ghost for 0.4 s, then turn and run; it follows but never touches.
				if (phase < 0.4) { s.player.x += 0.5 * dt; s.ghosts[0].x += 0.7 * dt; }
				else { s.player.x -= 2 * dt; s.ghosts[0].x -= 2.2 * dt; }
			}
		});
		expect(trials).toHaveLength(1);
		const t = trials[0];
		expect(t.outcome).toBe('overstayed');
		expect(t.engaged).toBe(true);
		expect(t.inRates).toBe(true);
		expect(t.endClosing).toBe(true);
		expect(t.endDist).toBeCloseTo(1.5, 1);
		expect(t.turnLeft!).toBeLessThan(0);
		expect(t.turnLeft!).toBeCloseTo(-0.4, 1);
		expect(t.reaction!).toBeCloseTo(0.4, 1);
		expect(t.after.died).toBe(false);
		expect(t.after.nearMiss).toBe(true);
		expect(t.after.seen).toBeCloseTo(3, 1);
		expect(t.after.cut).toBeNull();
		// 10 Hz series from start to 3 s after the end.
		expect(t.series.t.length).toBeGreaterThanOrEqual(79);
		expect(t.series.t.length).toBeLessThanOrEqual(82);
		expect(t.series.left[0]).toBeCloseTo(5, 1);
		expect(t.series.left.at(-1)!).toBeLessThan(-2.8);
		expect(t.fps).toBeCloseTo(60, 0);
	});

	it('caught: dies after the end to the ghost that had been scared', () => {
		const { trials } = scenario({
			total: 5,
			gap: (mt) => Math.max(1.5, 6 - 0.9 * mt),
			after: (s, dt) => { s.player.x += 0.5 * dt; s.ghosts[0].x -= 1 * dt; },
			at: (s) => { if (s.power.endReason === 'expired' && s.phase === 'playing' && s.t - s.power.endedAt >= 1) s.die(0); }
		});
		const t = trials[0];
		expect(t.outcome).toBe('caught');
		expect(t.after.caught).toBe(true);
		expect(t.after.killer).toBe('hunter');
		expect(t.after.timeToCaught!).toBeCloseTo(1, 1);
		expect(t.turnLeft).toBeNull(); // never turned away
		expect(t.endClosing).toBe(true);
		expect(t.inRates).toBe(true);
	});

	it('late catch: eats a ghost with 1.5 s or less left', () => {
		const { trials } = scenario({
			total: 5,
			gap: (mt) => Math.max(0, 6 - 1.5 * mt),
			at: (s) => { if (s.ghosts[0].scared && s.ghosts[0].x - s.player.x <= 0.5) s.eat(0); }
		});
		const t = trials[0];
		expect(t.outcome).toBe('late-catch');
		expect(t.lateCatch).toBe(true);
		expect(t.eats).toHaveLength(1);
		expect(t.eats[0].left).toBeLessThanOrEqual(1.5);
		expect(t.allEatenLeft).toBe(t.eats[0].left);
		expect(t.endDist).toBeNull(); // no ghost turned dangerous
	});

	it('timely retreat: closest with 0.2-2 s left, then backs off', () => {
		const { trials } = scenario({ total: 5, gap: (mt) => (mt < 3.8 ? 6 - 1.2 * mt : 1.44 + 1.5 * (mt - 3.8)) });
		const t = trials[0];
		expect(t.outcome).toBe('timely-retreat');
		expect(t.turnLeft!).toBeCloseTo(1.2, 1);
		expect(t.turnDist!).toBeCloseTo(1.44, 1);
		expect(t.turnAt!).toBeCloseTo(3.8, 1);
		expect(t.engaged).toBe(true);
		expect(t.endClosing).toBe(false);
	});

	it('early retreat in the warning window: engaged, wasted power recorded', () => {
		const { trials } = scenario({ total: 6, gap: (mt) => (mt < 3.4 ? 6 - 1.2 * mt : 1.92 + 1.2 * (mt - 3.4)) });
		const t = trials[0];
		expect(t.outcome).toBe('early-retreat');
		expect(t.turnLeft!).toBeCloseTo(2.6, 1);
		expect(t.turnReachable).toBe(true);
		expect(t.engaged).toBe(true);
		expect(t.inRates).toBe(true);
		expect(t.wasted).toBe(t.turnLeft);
	});

	it('early retreat before the warning window: kept but not engaged', () => {
		const { trials } = scenario({ total: 7, gap: (mt) => (mt < 3 ? 6 - 1.2 * mt : 2.4 + 1.5 * (mt - 3)) });
		const t = trials[0];
		expect(t.outcome).toBe('early-retreat');
		expect(t.turnLeft!).toBeCloseTo(4, 1);
		expect(t.engaged).toBe(false);
		expect(t.inRates).toBe(false);
	});

	it('not engaged: no chase at all', () => {
		const { trials } = scenario({ total: 5, gap: () => 10 });
		expect(trials[0].outcome).toBe('not-engaged');
		expect(trials[0].chases).toBe(0);
		expect(trials[0].series.dist[0]).toBeCloseTo(10, 1);
	});

	it('classify follows the order in STUDY.md', () => {
		const base = {
			endReason: 'expired' as const, eats: [], endClosing: false, endDist: null, turnLeft: null, turnReachable: null, engaged: true,
			after: { seen: 3, died: false, caught: false, timeToCaught: null, killer: null, minDangerDist: null, nearMiss: false, cut: null }
		};
		expect(classify({ ...base, after: { ...base.after, died: true, caught: true }, eats: [{ t: 1, left: 1, ghost: 'hunter', points: 200 }] })).toBe('caught');
		expect(classify({ ...base, eats: [{ t: 1, left: 1.5, ghost: 'hunter', points: 200 }], endClosing: true, endDist: 2 })).toBe('late-catch');
		expect(classify({ ...base, endClosing: true, endDist: 5, turnLeft: 1 })).toBe('overstayed');
		expect(classify({ ...base, endClosing: true, endDist: 5.1, turnLeft: 1 })).toBe('timely-retreat');
		expect(classify({ ...base, turnLeft: 2.1, turnReachable: true })).toBe('early-retreat');
		expect(classify({ ...base, turnLeft: 2.1, turnReachable: false })).toBe('other');
		expect(classify({ ...base, engaged: false })).toBe('not-engaged');
		expect(classify({ ...base, endReason: 'refreshed' })).toBe('interrupted');
	});
});

describe('tracker: edge cases', () => {
	it('second power dot during a power-up: refreshed, then a new trial', () => {
		const { trials } = scenario({
			total: 6, gap: () => 10, seconds: 16,
			at: (s) => { if (s.power.serial === 1 && s.mt >= 3) s.startPower(5); }
		});
		expect(trials).toHaveLength(2);
		expect(trials[0].endReason).toBe('refreshed');
		expect(trials[0].outcome).toBe('interrupted');
		expect(trials[0].leftAtEnd).toBeCloseTo(3, 1);
		expect(trials[0].inRates).toBe(false);
		expect(trials[1].serial).toBe(2);
		expect(trials[1].endReason).toBe('expired');
	});

	it('a power dot during the aftermath cuts it short', () => {
		const { trials } = scenario({
			total: 4, gap: () => 10, seconds: 14, after: () => {},
			at: (s) => { if (s.power.serial === 1 && s.power.endReason === 'expired' && s.t - s.power.endedAt >= 1) s.startPower(4); }
		});
		expect(trials[0].endReason).toBe('expired');
		expect(trials[0].after.seen).toBeCloseTo(1, 1);
		expect(trials[0].after.cut).toBe('power');
		expect(trials[1].serial).toBe(2);
	});

	it('death during the power: interrupted, diedDuring', () => {
		const { trials } = scenario({
			total: 6, gap: () => 5,
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
		const { trials } = scenario({
			total: 6, gap: () => 5,
			at: (s) => { if (s.mt >= 2 && s.phase === 'playing') { s.endPower('cleared'); s.phase = 'clear'; } }
		});
		expect(trials[0].endReason).toBe('cleared');
		expect(trials[0].outcome).toBe('interrupted');
	});

	it('all scared ghosts eaten early: nothing left to chase', () => {
		const { trials } = scenario({
			total: 6,
			gap: (mt) => Math.max(0, 4 - 2 * mt),
			at: (s) => { if (s.ghosts[0].scared && s.ghosts[0].x - s.player.x <= 0.5) s.eat(0); }
		});
		const t = trials[0];
		expect(t.allEatenLeft!).toBeGreaterThan(4);
		expect(t.turnLeft).toBe(t.allEatenLeft);
		expect(t.turnReachable).toBe(false);
		expect(t.engaged).toBe(false);
		expect(t.outcome).toBe('not-engaged');
	});

	it('eating the last ghost inside the warning window, not late: engaged, other', () => {
		const { trials } = scenario({
			total: 6,
			gap: (mt) => Math.max(0, 6 - 1.75 * mt),
			at: (s) => { if (s.ghosts[0].scared && s.ghosts[0].x - s.player.x <= 0.5) s.eat(0); }
		});
		const t = trials[0];
		expect(t.eats[0].left).toBeGreaterThan(1.5);
		expect(t.eats[0].left).toBeLessThan(3);
		expect(t.engaged).toBe(true);
		expect(t.outcome).toBe('other');
	});

	it('no ghost out of the pen: nothing scared, not engaged', () => {
		const { trials } = scenario({ total: 5, gap: () => 4, setup: (s) => { s.ghosts[0].mode = 'waiting'; s.ghosts[0].x = 20; s.ghosts[0].y = 4; } });
		expect(trials[0].scaredAtStart).toBe(0);
		expect(trials[0].series.dist.every((d) => d === null)).toBe(true);
		expect(trials[0].outcome).toBe('not-engaged');
	});

	it('the freeze after an eat does not break a chase on another ghost', () => {
		// Ghost 1 (ambusher) sits 1 tile behind the hunter; the player eats the hunter and keeps going.
		const s = new Sim();
		const tracker = createTracker();
		const trials: TrialMeasures[] = [];
		s.ghost(0, 14, ROW); s.ghost(1, 15.5, ROW);
		tracker.onScene(s.scene());
		s.startPower(7);
		const seen: { t: number; chasing: boolean }[] = [];
		while (s.t < 12) {
			if (s.ghosts[0].scared && s.ghosts[0].x - s.player.x <= 0.5) s.eat(0);
			s.step(DT, (sim, dt) => {
				if (sim.power.left > 0) { sim.player.x += 2 * dt; sim.ghosts[1].x += 0.5 * dt; }
			});
			trials.push(...tracker.onScene(s.scene()));
			seen.push({ t: s.t, chasing: tracker.live.chasing });
		}
		const t = trials[0];
		expect(t.eats).toHaveLength(1);
		// Game time stands still during the freeze: the series has no gap and no repeats there.
		for (let i = 1; i < t.series.t.length; i++) expect(t.series.t[i] - t.series.t[i - 1]).toBeLessThan(0.12);
		// Chasing ghost 1 continues straight after the freeze.
		const after = seen.find((x) => x.t > s.ghosts[0].eatenAt + 0.4)!;
		expect(after.chasing).toBe(true);
		expect(t.chases).toBe(2);
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

	it('leaving during the aftermath: kept, classified, but not in the rates', () => {
		const s = new Sim();
		const tracker = createTracker();
		s.ghost(0, 12, ROW);
		tracker.onScene(s.scene());
		s.startPower(4);
		// Chase toward the ghost so the trial is engaged, then leave 1 s after the end.
		while (!(s.power.endReason === 'expired' && s.t - s.power.endedAt >= 1)) {
			s.step(DT, (sim, dt) => { if (sim.power.left > 0) sim.player.x = Math.min(sim.player.x + 0.8 * dt, 11); });
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
		expect(tracker.live.state).toBe('idle');
	});

	it('live readout follows the power-up', () => {
		const s = new Sim();
		const tracker = createTracker();
		s.ghost(0, 14, ROW);
		tracker.onScene(s.scene());
		s.startPower(5);
		for (let i = 0; i < 60; i++) { s.step(DT, (sim, dt) => { sim.player.x += 2 * dt; }); tracker.onScene(s.scene()); }
		expect(tracker.live.state).toBe('power');
		expect(tracker.live.left).toBeCloseTo(4, 1);
		expect(tracker.live.nearest?.ghost).toBe('hunter');
		expect(tracker.live.nearest!.dist).toBeCloseTo(4, 1);
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
			if (t.endReason === 'expired') {
				expect(t.series.t.length).toBeGreaterThan((t.total + t.after.seen) * 10 - 3);
				expect(t.series.t.length).toBeLessThan((t.total + 3) * 10 + 8);
			}
			if (t.outcome === 'caught') expect(t.after.caught).toBe(true);
			if (t.inRates) expect(t.engaged && t.endReason === 'expired').toBe(true);
			for (let i = 1; i < t.series.t.length; i++) expect(t.series.t[i]).toBeGreaterThan(t.series.t[i - 1]);
		}
		const counts: Record<string, number> = {};
		for (const t of all) counts[t.outcome] = (counts[t.outcome] ?? 0) + 1;
		// The chasers produce catches; the ignorer produces unengaged trials.
		expect((counts['late-catch'] ?? 0) + (counts['caught'] ?? 0) + (counts['overstayed'] ?? 0)).toBeGreaterThan(0);
		expect(counts['not-engaged'] ?? 0).toBeGreaterThan(0);
		const reasons: Record<string, number> = {};
		for (const t of all) reasons[t.endReason] = (reasons[t.endReason] ?? 0) + 1;
		console.log('scripted outcomes', counts, 'end reasons', reasons, 'trials', all.length);
	}, 60_000);

	it('is deterministic for a seed', () => {
		const a = play('chase', 9, 60), b = play('chase', 9, 60);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	}, 30_000);
});
