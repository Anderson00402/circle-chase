/**
 * Turns the stream of scenes into one measured trial per power-up, as defined in docs/STUDY.md.
 * Pure TypeScript: no DOM, no Convex. Feed it every live scene with `onScene`; it returns the
 * trials that finished on that frame (also passed to `onTrial`).
 *
 * Clocks
 * - `left`: the power's own clock (`Frame.power.left`) while the power is on, and minus the
 *   seconds since it ran out afterwards. Every "time left" in a trial uses it.
 * - `clock`: seconds of live, moving play. It stops outside the `playing` phase and during the
 *   short freeze after a ghost is eaten, so "came no closer for 0.5 s" means 0.5 s of movement.
 *
 * What a chase is (STUDY.md "Chasing"; the numbers are `CHASE` in convex/lib/rules.ts)
 * - Distances are continuous path distances through the maze with tunnel wrap (`distance.ts`).
 * - Targets: during the power, ghosts that are scared and out of the pen. After it ran out, the
 *   ghosts that were scared at that moment (`revertedAt === endedAt`) and are still out.
 * - Only the player's own steps count. Every moving frame, for every target, `own` is how much the
 *   player's step changed the path distance to where that ghost is now (new distance minus the
 *   distance from the player's previous spot to the same point). A ghost walking toward a player
 *   who stands still or flees closes the gap without the player approaching it.
 * - An approach of one ghost starts with a step toward it while it is within range. It keeps a
 *   running sum of `own` and remembers its lowest point: the player's closest point by their own
 *   doing. It is over when the player's steps took them `backoff` tiles back from that point, when
 *   they came no closer for `idle` seconds, when the ghost got out of range, or when a ghost is eaten.
 * - An approach becomes a chase once the player's own steps closed `minGain` tiles. Shorter
 *   approaches leave no trace, so a blip is never a chase.
 * - The turn-away moment of a chase is that closest point, not the later frame on which the end
 *   was noticed. An approach is followed past the end of the power with the same rule, so a player
 *   closest with 0.3 s left who then only moves away turned with 0.3 s left.
 * - Eating a ghost ends the chase there (distance 0) and wipes every approach under way: whatever
 *   the player does next has to earn a new chase from nothing. An eat with no chase before it still
 *   counts as a chase that ended in an eat.
 * - No approach starts once the power is over. An approach that began before the end may still
 *   become a chase through steps taken after it (the player kept going at a ghost that had turned).
 * - The final decision is the chase whose turn-away moment came last (a chase still running when
 *   the trial closed counts as latest; of two that turned on the same frame, the nearer ghost).
 * - Engaged: some chase reached into the warning window (its turn-away or eat came with 3 s or
 *   less left, or it was still running).
 * - The outcome, eligibility and the "gave up early" flag come from the shared rules in
 *   convex/lib/rules.ts (`derive`), fed with the measures stored here, so Convex can recompute them.
 *
 * Edge cases
 * - Second power dot during a power-up: the running trial ends with `endReason: 'refreshed'`
 *   (outcome `interrupted`) and a new trial starts. A power dot eaten during the 3 s aftermath of
 *   the previous trial cuts that aftermath short (`after.seen` < 3); the trial is still classified.
 * - Death during the power: ends the trial at once, `endReason: 'died'`, `diedDuring`, outcome
 *   `interrupted` (a non-scared ghost, e.g. one that left the pen after the power began).
 * - Level clear during the power: `endReason: 'cleared'`, `interrupted`. During the aftermath: the
 *   aftermath is cut short as above.
 * - All scared ghosts eaten: `allEatenLeft` is set; no target remains, so no chase afterwards; the
 *   final chase ended at the last eat.
 * - No ghost out of the pen at the start: `scaredAtStart: 0`, nothing to chase, `not-engaged`.
 * - Freeze after eating a ghost: `clock` stops; frames that repeat the same moment are ignored, so
 *   the series has no gap and no repeats there.
 * - Pause: the game sends no frames while paused and game time stops, so nothing changes.
 * - Game over / new game / page closed: `finish()` closes a running power-up as `quit`
 *   (`interrupted`) at the last frame seen, with the power left at that frame, and an aftermath as
 *   cut short. A new game is detected when game time goes back.
 *
 * The live readout never gives the time left away: while a power-up runs it carries no clock, no
 * power length and nothing judged against the warning window; an outcome appears only once the
 * trial is closed.
 */
import { CAUGHT_DIST, CHASE, LATE, OVERSTAY_DIST, REACH_SPEED, RULES_VERSION, TIMELY, WARN, classify, derive, type ChaseParams } from '#convex/lib/rules.ts';
import type { Frame, GhostId, Scene } from '../game/types';
import { distanceField, type DistanceField } from './distance';
import type { Aftermath, ChaseRecord, EatRecord, LiveReadout, Outcome, TrialEndReason, TrialMeasures, TrialSeries } from './types';

export { CAUGHT_DIST, CHASE, LATE, OVERSTAY_DIST, REACH_SPEED, TIMELY, WARN, classify };
export const NEAR_MISS = 1.5;
export const AFTER = 3;
export const SERIES_STEP = 0.1;
/** A step counts as "toward the ghost" when it closes at least this much (tiles): ignores rounding. */
const STEP_EPS = 1e-4;
/** Chases kept in a trial's log (the latest ones). */
const LOG_MAX = 16;

/** One ghost the player is stepping toward. */
interface Approach {
	id: GhostId;
	/** Game time and power left at the first step toward the ghost. */
	startAt: number;
	startLeft: number;
	/** Sum of the player's own steps since then (negative: closer). */
	p: number;
	/** Lowest `p` so far, and the moment it was reached: the player's closest point by their own doing. */
	best: number;
	bestAt: number;
	bestLeft: number;
	bestDist: number;
	bestClock: number;
	/** The player's own steps closed `minGain` tiles: a chase. */
	confirmed: boolean;
}

interface Chase {
	/** Index of the ghost in `frame.ghosts`. */
	ghost: number;
	id: GhostId;
	endedBy: 'turn' | 'eat' | 'open';
	startAt: number;
	/** The turn-away moment (the eat, for a chase that ended in one). */
	at: number;
	left: number;
	dist: number;
	/** Tiles the player's own steps closed. */
	gain: number;
}

interface Run {
	serial: number;
	startedAt: number;
	total: number;
	level: number;
	mazeId: string;
	scaredAtStart: number;
	state: 'power' | 'after';
	endedAt: number;
	endReason: TrialEndReason | null;
	leftAtEnd: number;
	/** Power left on the last frame seen while it was on. */
	lastLeft: number;
	eats: EatRecord[];
	allEatenLeft: number | null;
	/** Approaches under way, by ghost index. */
	approach: (Approach | null)[];
	chases: Chase[];
	endDist: number | null;
	/** Path distance to each ghost that turned dangerous, when the power ran out (by ghost index). */
	endDistBy: (number | null)[];
	after: Aftermath;
	diedDuring: boolean;
	frames: number;
	lastT: number;
	series: TrialSeries;
	nextSample: number;
	// last measured values, reused for series samples and the live readout
	nearest: { ghost: GhostId; dist: number } | null;
	chasing: boolean;
}

export interface TrackerOptions {
	onTrial?: (trial: TrialMeasures) => void;
	/** Other chase numbers than `CHASE` (calibration and tests only; stored trials use the defaults). */
	chase?: Partial<ChaseParams>;
}

export interface Tracker {
	/** Feed every live scene. Returns trials that finished on this frame. */
	onScene(scene: Scene): TrialMeasures[];
	/** Close whatever is running (game over, page closed). Returns the trials closed. */
	finish(): TrialMeasures[];
	/** Forget everything (new game). Call `finish()` first to keep a running trial. */
	reset(): void;
	readonly live: LiveReadout;
}

const r2 = (v: number) => Math.round(v * 100) / 100 || 0; // `|| 0` turns -0 into 0
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const fin = (v: number) => (Number.isFinite(v) ? v : null);

export function createTracker(opts: TrackerOptions = {}): Tracker {
	const P: ChaseParams = { ...CHASE, ...opts.chase };
	let run: Run | null = null;
	let lastT = -1, lastSerial = 0, clock = 0;
	let prevLeft = -1, prevSerial = -1;
	let prevField: DistanceField | null = null, prevMaze = '';
	/** The trial closed last, for the readout between power-ups. */
	let closed: { outcome: Outcome; engaged: boolean } | null = null;
	let live: LiveReadout = idleLive();

	function idleLive(): LiveReadout {
		return { state: 'idle', left: 0, total: 0, nearest: null, chasing: false, engaged: closed?.engaged ?? false, guess: closed?.outcome ?? null };
	}

	function reset() {
		run = null;
		lastT = -1; lastSerial = 0; clock = 0; prevLeft = -1; prevSerial = -1;
		prevField = null; prevMaze = '';
		closed = null;
		live = idleLive();
	}

	function newRun(f: Frame): Run {
		const scared = f.ghosts.filter((g) => g.scared && g.mode === 'active').length;
		return {
			serial: f.power.serial, startedAt: f.power.startedAt, total: f.power.total, level: f.level, mazeId: f.mazeId,
			scaredAtStart: scared, state: 'power', endedAt: -1, endReason: null, leftAtEnd: 0, lastLeft: f.power.left, eats: [],
			allEatenLeft: null, approach: [], chases: [], endDist: null, endDistBy: [],
			after: { seen: 0, died: false, caught: false, timeToCaught: null, killer: null, minDangerDist: null, nearMiss: false, cut: null },
			diedDuring: false, frames: 0, lastT: f.t,
			series: { t: [], left: [], dist: [], chasing: [], px: [], py: [] },
			nextSample: f.power.startedAt, nearest: null, chasing: false
		};
	}

	/** The power's clock for this run at game time t. */
	function leftAt(r: Run, f: Frame): number {
		return r.state === 'power' ? f.power.left : -(f.t - r.endedAt);
	}

	/** Ends an approach. Only a chase (or an eat) leaves a record. */
	function closeApproach(r: Run, i: number, how: Chase['endedBy']) {
		const a = r.approach[i];
		r.approach[i] = null;
		if (!a || !a.confirmed) return;
		r.chases.push({ ghost: i, id: a.id, endedBy: how, startAt: a.startAt, at: a.bestAt, left: a.bestLeft, dist: a.bestDist, gain: -a.best });
	}

	/** The chase whose turn-away came last: the final decision. */
	function finalChase(chases: Chase[]): Chase | null {
		let last: Chase | null = null;
		for (const c of chases) {
			if (!last) { last = c; continue; }
			const a = c.endedBy === 'open' ? Infinity : c.at, b = last.endedBy === 'open' ? Infinity : last.at;
			const same = a === b || Math.abs(a - b) <= 1e-9;
			if (same ? c.dist < last.dist : a > b) last = c;
		}
		return last;
	}

	function finalize(r: Run, f: Frame | null, cut: Aftermath['cut'] = null): TrialMeasures {
		const closeT = f?.t ?? r.lastT;
		// Closed while the power was still on and nothing ended it: the player left.
		if (r.state === 'power' && !r.endReason) { r.endReason = 'quit'; r.endedAt = r.lastT; r.leftAtEnd = Math.max(0, r.lastLeft); }
		for (let i = 0; i < r.approach.length; i++) closeApproach(r, i, 'open');
		if (r.state === 'after' && !r.after.died) {
			r.after.seen = Math.min(AFTER, closeT - r.endedAt);
			r.after.cut = r.after.seen < AFTER - 1e-6 ? cut ?? 'quit' : null;
		}
		const expired = r.endReason === 'expired';
		const leftNow = r.state === 'power' ? r.leftAtEnd : -(closeT - r.endedAt);
		const win = Math.min(WARN, r.total);
		const engaged = r.chases.some((c) => (c.endedBy === 'open' ? Math.min(c.left, leftNow) : c.left) <= win);
		const last = finalChase(r.chases);
		const lastChaseEnd = last ? last.endedBy : null;
		// A chase still running when the trial closed never turned.
		const turned = last && last.endedBy !== 'open' ? last : null;
		const turnLeft = turned ? r2(turned.left) : null, turnDist = turned ? r2(turned.dist) : null;
		const turnReachable = turned && turned.endedBy === 'turn' ? turnLeft! > 0 && turnDist! <= turnLeft! * REACH_SPEED : null;
		const endClosing = expired ? lastChaseEnd === 'open' || (lastChaseEnd === 'turn' && turnLeft! < TIMELY[0]) : null;
		const endOf = (c: Chase) => (expired && c.endedBy !== 'eat' ? r.endDistBy[c.ghost] ?? null : null);
		const rd = (v: number | null) => (v === null ? null : r2(v));
		r.after.nearMiss = !r.after.died && r.after.minDangerDist !== null && r.after.minDangerDist <= NEAR_MISS;
		const chaseLog: ChaseRecord[] = r.chases.slice(-LOG_MAX).map((c) => ({
			ghost: c.id, from: r2(c.startAt - r.startedAt), at: r2(c.at - r.startedAt), left: r2(c.left), dist: r2(c.dist), gain: r2(c.gain),
			end: c.endedBy, endDist: rd(endOf(c))
		}));
		const m: Omit<TrialMeasures, 'outcome' | 'inRates' | 'wasted' | 'gaveUpEarly'> = {
			rulesVersion: RULES_VERSION,
			serial: r.serial, startedAt: r3(r.startedAt), endedAt: r3(r.endedAt), total: r3(r.total), level: r.level,
			mazeId: r.mazeId, endReason: r.endReason ?? 'quit', leftAtEnd: r2(r.leftAtEnd), scaredAtStart: r.scaredAtStart,
			engaged, eats: r.eats, lateCatch: r.eats.some((e) => e.left <= LATE), allEatenLeft: r.allEatenLeft,
			turnLeft, turnDist, turnAt: turned ? r2(turned.at - r.startedAt) : null,
			turnReachable, chases: r.chases.length, lastChaseEnd,
			chaseEndDist: last ? rd(endOf(last)) : null, chaseGain: last ? r2(last.gain) : null, chaseGhost: last ? last.id : null,
			chaseLog,
			endDist: expired && r.endDist !== null ? r2(r.endDist) : null, endClosing,
			after: { ...r.after, seen: r2(r.after.seen), minDangerDist: r.after.minDangerDist === null ? null : r2(r.after.minDangerDist) },
			// How long after the end the player kept stepping toward the ghost; 0 when their last such step came just before it.
			reaction: endClosing && turnLeft !== null ? Math.max(0, -turnLeft) : null,
			diedDuring: r.diedDuring, frames: r.frames,
			fps: r.lastT > r.startedAt ? Math.round((r.frames / (r.lastT - r.startedAt)) * 10) / 10 : 0,
			series: r.series
		};
		return { ...m, ...derive(m) };
	}

	function end(r: Run, f: Frame | null, out: TrialMeasures[], cut: Aftermath['cut'] = null) {
		const trial = finalize(r, f, cut);
		run = null;
		closed = { outcome: trial.outcome, engaged: trial.engaged };
		out.push(trial);
		opts.onTrial?.(trial);
	}

	function sample(r: Run, f: Frame, W: number) {
		const left = leftAt(r, f);
		while (f.t + 1e-9 >= r.nextSample) {
			const s = r.series;
			s.t.push(r2(f.t - r.startedAt));
			s.left.push(r2(left));
			s.dist.push(r.nearest ? r2(r.nearest.dist) : null);
			s.chasing.push(r.chasing ? 1 : 0);
			s.px.push(((Math.round(f.player.x) % W) + W) % W);
			s.py.push(Math.round(f.player.y));
			r.nextSample += SERIES_STEP;
			// After a long gap take one sample, not a burst of copies.
			if (r.nextSample < f.t) r.nextSample = f.t + SERIES_STEP - ((f.t - r.startedAt) % SERIES_STEP);
		}
	}

	/** Distances and approach bookkeeping for one moving frame. */
	function measure(r: Run, scene: Scene) {
		const f = scene.frame, maze = scene.maze;
		const field = distanceField(maze, f.player.x, f.player.y);
		const prev = prevMaze === maze.id ? prevField : null;
		const left = leftAt(r, f);
		const inPower = r.state === 'power';
		let nearest = -1, nearestDist = Infinity, danger = Infinity;
		f.ghosts.forEach((g, i) => {
			const dist = g.mode === 'active' ? field.to(g.x, g.y) : Infinity;
			if (g.mode === 'active' && !inPower && !g.scared) danger = Math.min(danger, dist);
			const target = g.mode === 'active' && (inPower ? g.scared : g.revertedAt === r.endedAt) && Number.isFinite(dist);
			if (!target) { closeApproach(r, i, 'turn'); return; }
			if (dist < nearestDist) { nearestDist = dist; nearest = i; }
			// How much the player's own step changed the distance to where the ghost is now.
			let own = 0;
			if (prev) { const was = prev.to(g.x, g.y); if (Number.isFinite(was)) own = dist - was; }
			let a = r.approach[i] ?? null;
			if (!a) {
				if (!inPower || own > -STEP_EPS || dist > P.range) return;
				a = r.approach[i] = {
					id: g.id, startAt: f.t, startLeft: left, p: own, best: own, bestAt: f.t, bestLeft: left, bestDist: dist, bestClock: clock, confirmed: false
				};
			} else {
				a.p += own;
				if (a.p < a.best - 1e-9) { a.best = a.p; a.bestAt = f.t; a.bestLeft = left; a.bestDist = dist; a.bestClock = clock; }
			}
			if (!a.confirmed && -a.best >= P.minGain) a.confirmed = true;
			if (a.p - a.best >= P.backoff || clock - a.bestClock >= P.idle || (inPower && dist > P.range)) closeApproach(r, i, 'turn');
		});
		prevField = field;
		prevMaze = maze.id;
		if (!inPower && Number.isFinite(danger)) r.after.minDangerDist = Math.min(r.after.minDangerDist ?? Infinity, danger);
		r.nearest = nearest >= 0 ? { ghost: f.ghosts[nearest].id, dist: nearestDist } : null;
		r.chasing = r.approach.some((a) => !!a && a.confirmed);
	}

	function startAftermath(r: Run, scene: Scene) {
		r.state = 'after';
		// Exposure: how far each ghost that just turned dangerous is, and the nearest of them.
		const f = scene.frame;
		const field = distanceField(scene.maze, f.player.x, f.player.y);
		let best = Infinity;
		f.ghosts.forEach((g, i) => {
			if (g.mode !== 'active' || g.revertedAt !== r.endedAt) return;
			const d = field.to(g.x, g.y);
			r.endDistBy[i] = fin(d);
			best = Math.min(best, d);
		});
		r.endDist = fin(best);
	}

	function onScene(scene: Scene): TrialMeasures[] {
		const f = scene.frame;
		const out: TrialMeasures[] = [];
		// A new game: time went back.
		if (lastT >= 0 && f.t < lastT - 1e-9) {
			if (run) end(run, null, out);
			reset();
		}
		const dt = lastT < 0 ? 0 : f.t - lastT;
		// The same moment twice (a redraw without an update): nothing happened.
		if (lastT >= 0 && dt <= 0 && !f.events.length) return out;
		lastT = f.t;
		const p = f.power;

		// A new power-up. Closes the previous trial: still on -> refreshed, aftermath -> cut short.
		if (p.serial > lastSerial) {
			if (run) {
				if (run.state === 'power') { run.endReason = 'refreshed'; run.endedAt = p.startedAt; run.leftAtEnd = prevLeft > 0 ? prevLeft : 0; }
				end(run, f, out, 'power');
			}
			lastSerial = p.serial;
			run = newRun(f);
			// Steps are compared within this power-up only.
			prevField = null;
		}
		const r = run;
		if (r) {
			r.frames++;
			r.lastT = f.t;
			for (const e of f.events) {
				if (e.type === 'eat' && r.state === 'power' && e.t >= r.startedAt - 1e-9) {
					r.eats.push({ t: r2(e.t - r.startedAt), left: r2(e.left), ghost: e.ghost, points: e.points });
					// Eating ends the chase there, at distance 0, and wipes every approach under way:
					// an eat can end a chase but never start one.
					const i = f.ghosts.findIndex((g) => g.id === e.ghost);
					const a = i >= 0 ? r.approach[i] ?? null : null;
					r.chases.push({ ghost: i, id: e.ghost, endedBy: 'eat', startAt: a ? a.startAt : e.t, at: e.t, left: e.left, dist: 0, gain: a ? -a.best : 0 });
					r.approach = [];
					if (f.ghosts.every((g) => !g.scared)) r.allEatenLeft = r2(e.left);
				} else if (e.type === 'die') {
					if (r.state === 'power') r.diedDuring = true;
					else {
						r.after.died = true;
						r.after.killer = e.by;
						r.after.timeToCaught = r2(e.t - r.endedAt);
						const killer = f.ghosts.find((g) => g.id === e.by);
						r.after.caught = !!killer && killer.revertedAt === r.endedAt;
						if (!r.after.caught) r.after.timeToCaught = null;
						r.after.seen = e.t - r.endedAt;
					}
				}
			}

			// The power-up ended.
			if (r.state === 'power' && p.serial === r.serial && p.endReason && p.endedAt >= r.startedAt) {
				r.endedAt = p.endedAt;
				r.endReason = p.endReason;
				r.leftAtEnd = p.endReason === 'expired' ? 0 : prevSerial === r.serial ? prevLeft : 0;
				if (p.endReason === 'expired') startAftermath(r, scene);
				else { end(r, f, out); }
			} else if (r.state === 'power' && p.serial === r.serial) r.lastLeft = p.left;
		}

		const cur = run;
		if (cur) {
			if (cur.state === 'after' && cur.after.died) end(cur, null, out);
			else if (cur.state === 'after' && (f.t - cur.endedAt >= AFTER - 1e-9 || f.phase === 'clear' || f.phase === 'over')) {
				end(cur, f, out, f.phase === 'clear' ? 'clear' : 'quit');
			} else {
				const frozen = cur.state === 'power' && prevSerial === p.serial && p.left === prevLeft && p.left > 0;
				const moving = f.phase === 'playing' && dt > 0 && !frozen;
				if (moving) {
					clock += dt;
					measure(cur, scene);
				}
				sample(cur, f, scene.maze.W);
			}
		}
		prevLeft = p.left;
		prevSerial = p.serial;
		live = readout(run, f);
		return out;
	}

	/**
	 * What the panel may show. While the power is on: only what does not depend on the time left
	 * (the nearest scared ghost and whether the player is going after one). In the aftermath the
	 * power is over, so the seconds since it ran out are no secret. An outcome only between trials.
	 */
	function readout(r: Run | null, f: Frame): LiveReadout {
		if (!r) return idleLive();
		const nearest = r.nearest ? { ghost: r.nearest.ghost, dist: r2(r.nearest.dist) } : null;
		if (r.state === 'power') return { state: 'power', left: 0, total: 0, nearest, chasing: r.chasing, engaged: false, guess: null };
		return { state: 'after', left: r2(-(f.t - r.endedAt)), total: r.total, nearest, chasing: r.chasing, engaged: false, guess: null };
	}

	return {
		onScene,
		finish() {
			const out: TrialMeasures[] = [];
			if (run) end(run, null, out);
			live = idleLive();
			return out;
		},
		reset,
		get live() { return live; }
	};
}
