/**
 * Turns the stream of scenes into one measured trial per power-up, as defined in docs/STUDY.md.
 * Pure TypeScript: no DOM, no Convex. Feed it every live scene with `onScene`; it returns the
 * trials that finished on that frame (also passed to `onTrial`).
 *
 * Clocks
 * - `left`: the power's own clock (`Frame.power.left`) while the power is on, and minus the
 *   seconds since it ran out afterwards. Every "time left" in a trial uses it.
 * - `clock`: seconds of live, moving play. It stops outside the `playing` phase and during the
 *   short freeze after a ghost is eaten, so "shrinking over the last 0.3 s" always compares two
 *   moments 0.3 s of movement apart. (The engine stops game time during that freeze; should it ever
 *   keep running, the tracker still notices the freeze because the power's clock stands still.)
 *
 * Interpretations of STUDY.md (also listed in convex/README.md)
 * - Distances are continuous path distances through the maze with tunnel wrap (`distance.ts`).
 * - Targets: during the power, ghosts that are scared and out of the pen. After it ran out, the
 *   ghosts that were scared at that moment (`revertedAt === endedAt`) and are still out.
 * - Chasing during the power is the literal definition: the nearest target within 8 tiles is
 *   closer than the same ghost was 0.3 s earlier (by more than 0.05 tiles), or at most 1 tile away.
 * - After the end the ghosts hunt the player, so total distance shrinks even when the player
 *   flees. There, "still closing in" uses only the player's own movement: the sum over the last
 *   0.3 s of how much each of the player's steps changed the distance to that ghost must be below
 *   -0.05 tiles. Only a chase that was running at the end can continue after it; a new one never
 *   starts once the power is over.
 * - Turn-away: the last chase of the trial. Its turn moment is when the player was closest to the
 *   target (latest moment within 0.05 tiles of the minimum). If that chase ran past the end, the
 *   turn moment is the last step that still brought the player closer. A chase that ends by eating
 *   a ghost turns at the eat (distance 0). A chase still running when the trial closes never turned:
 *   turnLeft is null.
 * - "Still closing in at the end" (overstayed, exposure): the last chase is not an eat and either
 *   never turned or turned with less than 0.2 s left. With the timely window starting at 0.2 s this
 *   leaves no gap between "timely retreat" and "overstayed".
 * - Early retreat "while a ghost was still reachable": at the turn moment some scared ghost was out
 *   and its current spot was within (time left x player speed on level 1) tiles.
 * - An aftermath cut short is kept and classified with what was seen (`after.seen`, `after.cut`);
 *   one cut by the player leaving (`cut: 'quit'`) does not count toward the rates.
 * - An eat in the warning window counts as chasing there (engaged).
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
 * - Freeze after eating a ghost: `clock` stops (see above); frames that repeat the same moment are
 *   ignored, so the series has no gap and no repeats there.
 * - Pause: the game sends no frames while paused and game time stops, so nothing changes.
 * - Game over / new game / page closed: `finish()` closes a running power-up as `quit`
 *   (`interrupted`) and an aftermath as cut short. A new game is detected when game time goes back.
 */
import { PLAYER_SPEED } from '../game/engine/game';
import type { Frame, GhostId, Scene } from '../game/types';
import { distanceField, type DistanceField } from './distance';
import type { Aftermath, EatRecord, LiveReadout, Outcome, TrialEndReason, TrialMeasures, TrialSeries } from './types';

export const CHASE_RANGE = 8; // tiles
export const TREND = 0.3; // seconds of movement compared for "shrinking"
export const SHRINK = 0.05; // tiles the distance must drop over TREND
export const NEAR = 1; // tiles: always chasing this close
export const WARN = 3; // seconds: the warning window and the aftermath
export const LATE = 1.5; // seconds: late catch
export const OVERSTAY_DIST = 5;
export const TIMELY: [number, number] = [0.2, 2];
export const NEAR_MISS = 1.5;
export const AFTER = 3;
export const SERIES_STEP = 0.1;
/** Before 0.3 s of history exists, compare with the oldest sample once it is this old. */
const MIN_TREND = 0.15;
/** Near the minimum: the turn moment is the latest moment within this of the closest distance. */
const MIN_TOL = 0.05;

interface Sample {
	clock: number;
	/** Distance per ghost (index in frame.ghosts) when it is a target, NaN otherwise. */
	d: number[];
	/** How much the player's own step since the last sample changed the distance to each target. */
	own: number[];
}

interface Chase {
	endedBy: 'turn' | 'eat' | 'open';
	minD: number;
	minLeft: number;
	/** Game time of the closest moment. */
	minAt: number;
	reachable: boolean | null;
	/** Running when the power ran out. */
	crossedEnd: boolean;
	/** After the end: last step that still brought the player closer. */
	afterLeft: number | null;
	afterDist: number | null;
	afterAt: number | null;
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
	eats: EatRecord[];
	allEatenLeft: number | null;
	chases: Chase[];
	chase: Chase | null;
	engaged: boolean;
	endDist: number | null;
	after: Aftermath;
	firstAway: number | null;
	diedDuring: boolean;
	frames: number;
	lastT: number;
	series: TrialSeries;
	nextSample: number;
	needReach: boolean;
	// last measured values, reused for series samples and the live readout
	nearest: { ghost: GhostId; dist: number } | null;
	chasing: boolean;
}

export interface TrackerOptions {
	onTrial?: (trial: TrialMeasures) => void;
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
	let run: Run | null = null;
	let lastT = -1, lastSerial = 0, clock = 0;
	let prevLeft = -1, prevSerial = -1;
	let prevField: DistanceField | null = null, prevMaze = '';
	let history: Sample[] = [];
	let live: LiveReadout = idleLive();

	function idleLive(): LiveReadout {
		return { state: 'idle', left: 0, total: 0, nearest: null, chasing: false, engaged: false, guess: null };
	}

	function reset() {
		run = null;
		lastT = -1; lastSerial = 0; clock = 0; prevLeft = -1; prevSerial = -1;
		prevField = null; prevMaze = '';
		history = [];
		live = idleLive();
	}

	function newRun(f: Frame): Run {
		const scared = f.ghosts.filter((g) => g.scared && g.mode === 'active').length;
		return {
			serial: f.power.serial, startedAt: f.power.startedAt, total: f.power.total, level: f.level, mazeId: f.mazeId,
			scaredAtStart: scared, state: 'power', endedAt: -1, endReason: null, leftAtEnd: 0, eats: [],
			allEatenLeft: null, chases: [], chase: null, engaged: false, endDist: null,
			after: { seen: 0, died: false, caught: false, timeToCaught: null, killer: null, minDangerDist: null, nearMiss: false, cut: null },
			firstAway: null, diedDuring: false, frames: 0, lastT: f.t,
			series: { t: [], left: [], dist: [], chasing: [], px: [], py: [] },
			nextSample: f.power.startedAt, needReach: false, nearest: null, chasing: false
		};
	}

	/** The power's clock for this run at game time t. */
	function leftAt(r: Run, f: Frame): number {
		return r.state === 'power' ? f.power.left : -(f.t - r.endedAt);
	}

	function closeChase(r: Run, how: Chase['endedBy']) {
		if (!r.chase) return;
		r.chase.endedBy = how;
		r.chases.push(r.chase);
		r.chase = null;
	}

	function finalize(r: Run, f: Frame | null, cut: Aftermath['cut'] = null): TrialMeasures {
		if (r.chase) closeChase(r, 'open');
		if (r.state === 'after' && !r.after.died) {
			r.after.seen = Math.min(AFTER, (f?.t ?? r.lastT) - r.endedAt);
			r.after.cut = r.after.seen < AFTER - 1e-6 ? cut ?? 'quit' : null;
		}
		const last = r.chases.length ? r.chases[r.chases.length - 1] : null;
		let turnLeft: number | null = null, turnDist: number | null = null, turnReachable: boolean | null = null, turnAt: number | null = null;
		if (last && last.endedBy !== 'open') {
			if (last.endedBy === 'turn' && last.crossedEnd && last.afterLeft !== null) {
				turnLeft = last.afterLeft;
				turnDist = last.afterDist;
				turnAt = last.afterAt;
				turnReachable = false; // the power was over
			} else {
				turnLeft = last.minLeft;
				turnDist = last.minD;
				turnAt = last.minAt;
				turnReachable = last.reachable;
			}
		}
		const expired = r.endReason === 'expired';
		let endClosing: boolean | null = null;
		if (expired) {
			endClosing = !!last && last.endedBy !== 'eat' && (turnLeft === null ? last.crossedEnd : turnLeft < TIMELY[0]);
		}
		r.after.nearMiss = !r.after.died && r.after.minDangerDist !== null && r.after.minDangerDist <= NEAR_MISS;
		const reaction = endClosing && r.firstAway !== null ? r2(r.firstAway) : null;
		const lateCatch = r.eats.some((e) => e.left <= LATE);
		const m: Omit<TrialMeasures, 'outcome' | 'inRates' | 'wasted'> = {
			serial: r.serial, startedAt: r3(r.startedAt), endedAt: r3(r.endedAt), total: r3(r.total), level: r.level,
			mazeId: r.mazeId, endReason: r.endReason ?? 'quit', leftAtEnd: r2(r.leftAtEnd), scaredAtStart: r.scaredAtStart,
			engaged: r.engaged, eats: r.eats, lateCatch, allEatenLeft: r.allEatenLeft,
			turnLeft: turnLeft === null ? null : r2(turnLeft), turnDist: turnDist === null ? null : r2(turnDist),
			turnAt: turnAt === null ? null : r2(turnAt - r.startedAt),
			turnReachable, chases: r.chases.length,
			endDist: expired && r.endDist !== null ? r2(r.endDist) : null, endClosing,
			after: { ...r.after, seen: r2(r.after.seen), minDangerDist: r.after.minDangerDist === null ? null : r2(r.after.minDangerDist) },
			reaction, diedDuring: r.diedDuring, frames: r.frames,
			fps: r.lastT > r.startedAt ? Math.round((r.frames / (r.lastT - r.startedAt)) * 10) / 10 : 0,
			series: r.series
		};
		const outcome = classify(m);
		return {
			...m, outcome,
			inRates: m.engaged && expired && m.after.cut !== 'quit',
			wasted: outcome === 'early-retreat' ? m.turnLeft : null
		};
	}

	function end(r: Run, f: Frame | null, out: TrialMeasures[], cut: Aftermath['cut'] = null) {
		const trial = finalize(r, f, cut);
		run = null;
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

	/** Distances, chasing and chase bookkeeping for one moving frame. */
	function measure(r: Run, scene: Scene) {
		const f = scene.frame, maze = scene.maze;
		const field = distanceField(maze, f.player.x, f.player.y);
		const prev = prevMaze === maze.id ? prevField : null;
		const left = leftAt(r, f);
		const inPower = r.state === 'power';
		const d: number[] = [], own: number[] = [];
		let k = -1, reach = false, danger = Infinity;
		f.ghosts.forEach((g, i) => {
			d[i] = NaN; own[i] = 0;
			if (g.mode !== 'active') return;
			const target = inPower ? g.scared : g.revertedAt === r.endedAt;
			const dist = field.to(g.x, g.y);
			if (!inPower && !g.scared) danger = Math.min(danger, dist);
			if (!target || !Number.isFinite(dist)) return;
			d[i] = dist;
			if (prev) { const p = prev.to(g.x, g.y); if (Number.isFinite(p)) own[i] = dist - p; }
			if (k < 0 || dist < d[k]) k = i;
			if (inPower && dist <= left * PLAYER_SPEED) reach = true;
		});
		prevField = field;
		prevMaze = maze.id;
		const now: Sample = { clock, d, own };
		history.push(now);
		while (history.length > 2 && history[1].clock <= clock - 1) history.shift();

		if (!inPower && Number.isFinite(danger)) {
			r.after.minDangerDist = Math.min(r.after.minDangerDist ?? Infinity, danger);
		}
		const dist = k >= 0 ? d[k] : Infinity;
		r.nearest = k >= 0 ? { ghost: f.ghosts[k].id, dist } : null;

		let chasing = false;
		if (k >= 0 && dist <= CHASE_RANGE) {
			if (inPower) {
				if (dist <= NEAR) chasing = true;
				else {
					let past: Sample | null = null;
					for (let i = history.length - 1; i >= 0; i--) if (history[i].clock <= clock - TREND + 1e-9) { past = history[i]; break; }
					if (!past && history.length && clock - history[0].clock >= MIN_TREND) past = history[0];
					if (past && Number.isFinite(past.d[k]) && dist < past.d[k] - SHRINK) chasing = true;
				}
			} else if (r.chase && r.chase.crossedEnd) {
				let sum = 0;
				for (let i = history.length - 1; i >= 0 && history[i].clock > clock - TREND + 1e-9; i--) sum += history[i].own[k] || 0;
				chasing = sum < -SHRINK;
			}
		}
		r.chasing = chasing;
		if (r.needReach && inPower) { if (r.chases.length) r.chases[r.chases.length - 1].reachable = reach; r.needReach = false; }

		// Reaction: first step after the end that took the player farther from the nearest target.
		if (!inPower && r.firstAway === null && k >= 0 && own[k] > 0.01) r.firstAway = f.t - r.endedAt;

		if (chasing) {
			if (inPower && left > 0 && left <= Math.min(WARN, r.total)) r.engaged = true;
			if (!r.chase) {
				r.chase = { endedBy: 'open', minD: dist, minLeft: left, minAt: f.t, reachable: reach, crossedEnd: false, afterLeft: null, afterDist: null, afterAt: null };
			} else if (inPower) {
				if (dist < r.chase.minD - 1e-6) { r.chase.minD = dist; r.chase.minLeft = left; r.chase.minAt = f.t; r.chase.reachable = reach; }
				else if (dist <= r.chase.minD + MIN_TOL) { r.chase.minLeft = left; r.chase.minAt = f.t; r.chase.reachable = reach; }
			} else if (own[k] < -0.001) {
				r.chase.afterLeft = left;
				r.chase.afterDist = dist;
				r.chase.afterAt = f.t;
			}
		} else if (r.chase) closeChase(r, 'turn');
	}

	function startAftermath(r: Run, scene: Scene) {
		r.state = 'after';
		if (r.chase) r.chase.crossedEnd = true;
		// Exposure: nearest ghost that just turned dangerous.
		const f = scene.frame;
		const field = distanceField(scene.maze, f.player.x, f.player.y);
		let best = Infinity;
		for (const g of f.ghosts) if (g.mode === 'active' && g.revertedAt === r.endedAt) best = Math.min(best, field.to(g.x, g.y));
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
			// Chasing compares moments of this power-up only.
			history = [];
			prevField = null;
		}
		const r = run;
		if (r) {
			r.frames++;
			r.lastT = f.t;
			for (const e of f.events) {
				if (e.type === 'eat' && r.state === 'power' && e.t >= r.startedAt - 1e-9) {
					r.eats.push({ t: r2(e.t - r.startedAt), left: r2(e.left), ghost: e.ghost, points: e.points });
					if (e.left <= Math.min(WARN, r.total)) r.engaged = true;
					// Eating ends the chase there, at distance 0.
					if (!r.chase) r.chase = { endedBy: 'open', minD: 0, minLeft: e.left, minAt: e.t, reachable: null, crossedEnd: false, afterLeft: null, afterDist: null, afterAt: null };
					r.chase.minD = 0;
					r.chase.minLeft = e.left;
					r.chase.minAt = e.t;
					closeChase(r, 'eat');
					r.needReach = true;
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
			}
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

	function readout(r: Run | null, f: Frame): LiveReadout {
		if (!r) return idleLive();
		const left = leftAt(r, f);
		return {
			state: r.state, left: r2(left), total: r.total, nearest: r.nearest ? { ghost: r.nearest.ghost, dist: r2(r.nearest.dist) } : null,
			chasing: r.chasing, engaged: r.engaged, guess: guess(r, left)
		};
	}

	/** Outcome so far, for the live panel: classify a copy as if the trial ended now. */
	function guess(r: Run, left: number): Outcome | null {
		if (r.eats.some((e) => e.left <= LATE)) return 'late-catch';
		if (r.state === 'power') {
			if (left > WARN) return null;
			if (r.chasing && left < TIMELY[0]) return 'overstayed';
			if (r.chasing) return null;
			const last = r.chases[r.chases.length - 1];
			if (last) {
				const t = last.minLeft;
				if (t >= TIMELY[0] && t <= TIMELY[1]) return 'timely-retreat';
				if (t > TIMELY[1] && last.reachable) return 'early-retreat';
			}
			return r.engaged ? null : 'not-engaged';
		}
		const copy: Run = { ...r, chases: [...r.chases], chase: r.chase ? { ...r.chase } : null, after: { ...r.after } };
		return finalize(copy, f0(r, left)).outcome;
	}
	const f0 = (r: Run, left: number) => ({ t: r.endedAt - left } as Frame);

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

/**
 * Outcome of a trial, first that applies (STUDY.md). Exported for tests and for re-scoring stored
 * trials if a threshold changes.
 */
export function classify(m: Pick<TrialMeasures, 'endReason' | 'after' | 'eats' | 'endClosing' | 'endDist' | 'turnLeft' | 'turnReachable' | 'engaged'>): Outcome {
	if (m.endReason !== 'expired') return 'interrupted';
	if (m.after.caught) return 'caught';
	if (m.eats.some((e) => e.left <= LATE)) return 'late-catch';
	if (m.endClosing && m.endDist !== null && m.endDist <= OVERSTAY_DIST && !m.after.died) return 'overstayed';
	if (m.turnLeft !== null && m.turnLeft >= TIMELY[0] && m.turnLeft <= TIMELY[1]) return 'timely-retreat';
	if (m.turnLeft !== null && m.turnLeft > TIMELY[1] && m.turnReachable) return 'early-retreat';
	if (!m.engaged) return 'not-engaged';
	return 'other';
}
