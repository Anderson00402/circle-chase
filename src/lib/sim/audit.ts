/**
 * A second opinion on the outcome of a trial, worked out from the scenes of its replay clip.
 *
 * Written from the text of docs/STUDY.md and nothing else: it shares no code with the tracker
 * (`telemetry/tracker.ts`), the rules (`convex/lib/rules.ts`) or the tracker's distance function,
 * and it sees the game at the clip's 20 frames a second instead of the tracker's 60. Its own path
 * distances, its own chase detection, its own rules; the numbers below are typed in again from
 * STUDY.md on purpose. When it and the stored outcome agree, two separate readings of the
 * definition agree.
 *
 * Used by `audit.test.ts` (every trial of freshly simulated blocks) and by the stored-data audit
 * (`AUDIT_RUN=<run id> npx vitest run src/lib/sim/audit.test.ts`).
 */
import { PATH, type Maze, type Scene } from '../game/types';

// ----- the numbers of STUDY.md, restated -----
const RANGE = 6; // tiles: a ghost farther away is not a plausible target
const MIN_GAIN = 3; // tiles the player's own steps must close before an approach is a chase
const BACK_OFF = 1; // tiles back from the closest point: the chase is over
const STALL = 0.5; // seconds without coming closer: the chase is over
const WINDOW = 3; // seconds: the warning window
const IN_TIME: [number, number] = [0.2, 2]; // seconds left: turned away in time
const NEAR_AT_END = 5; // tiles: stayed too long, and caught, need a ghost this near when the power ends
const PLAYER_SPEED = 5.6; // tiles per second: what "reachable" assumes

// ----- path distance: breadth-first search on open tiles, edges wrap, positions between tiles -----
const floods = new WeakMap<Maze, Map<number, Int16Array>>();
function flood(m: Maze, from: number): Int16Array {
	let cache = floods.get(m);
	if (!cache) floods.set(m, (cache = new Map()));
	let d = cache.get(from);
	if (d) return d;
	d = new Int16Array(m.W * m.H).fill(-1);
	if (m.tiles[from] === PATH) {
		const queue = [from];
		d[from] = 0;
		for (let h = 0; h < queue.length; h++) {
			const c = queue[h], x = c % m.W, y = (c - x) / m.W;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const ny = y + dy;
				if (ny < 0 || ny >= m.H) continue;
				const j = ny * m.W + ((x + dx + m.W) % m.W);
				if (d[j] >= 0 || m.tiles[j] !== PATH) continue;
				d[j] = d[c] + 1;
				queue.push(j);
			}
		}
	}
	cache.set(from, d);
	return d;
}

/** A position as the tiles it lies on or between, with the walk to each. */
function feet(m: Maze, x: number, y: number): { tile: number; walk: number }[] {
	const col = (v: number) => ((v % m.W) + m.W) % m.W;
	const fx = x - Math.floor(x), fy = y - Math.floor(y);
	const between = (f: number) => f > 1e-6 && f < 1 - 1e-6;
	if (between(fx)) return [{ tile: Math.round(y) * m.W + col(Math.floor(x)), walk: fx }, { tile: Math.round(y) * m.W + col(Math.floor(x) + 1), walk: 1 - fx }];
	if (between(fy)) return [{ tile: Math.floor(y) * m.W + col(Math.round(x)), walk: fy }, { tile: (Math.floor(y) + 1) * m.W + col(Math.round(x)), walk: 1 - fy }];
	return [{ tile: Math.round(y) * m.W + col(Math.round(x)), walk: 0 }];
}

export function pathBetween(m: Maze, ax: number, ay: number, bx: number, by: number): number {
	const A = feet(m, ax, ay), B = feet(m, bx, by);
	let best = Infinity;
	for (const a of A) {
		if (a.tile < 0 || a.tile >= m.W * m.H) continue;
		const d = flood(m, a.tile);
		for (const b of B) if (b.tile >= 0 && b.tile < d.length && d[b.tile] >= 0) best = Math.min(best, a.walk + d[b.tile] + b.walk);
	}
	// Both between the same two tiles: the straight gap is shorter than going by either tile.
	if (A.length === 2 && B.length === 2 && A.every((a) => B.some((b) => b.tile === a.tile))) {
		let dx = Math.abs(ax - bx);
		dx = Math.min(dx, m.W - dx);
		best = Math.min(best, dx + Math.abs(ay - by));
	}
	return best;
}

// ----- one trial, from its scenes -----
export interface AuditTrial {
	serial: number;
	startedAt: number;
	endedAt: number;
	total: number;
	endReason: string;
	/** Why the aftermath was cut, as stored (the audit cannot know that the player left the page). */
	cut: string | null;
}

export interface AuditChase {
	ghost: string;
	end: 'turn' | 'eat' | 'open';
	/** Game time, power left and distance at the turn-away (the closest point by the player's own steps), or at the eat. */
	at: number;
	left: number;
	dist: number;
	gain: number;
	/** Distance to this ghost when the power ran out. */
	atEnd: number | null;
}

export interface AuditResult {
	outcome: string;
	engaged: boolean;
	inRates: boolean;
	gaveUpEarly: boolean;
	chases: AuditChase[];
	last: AuditChase | null;
	/** Nearest ghost that had just turned dangerous when the power ran out. */
	endDist: number | null;
	died: boolean;
	caught: boolean;
	/**
	 * How close the call was: the smallest gap between a value that decided the class and the line
	 * it was judged against (tiles or seconds), and which line that was. The lines: 3 tiles of own
	 * approach for any approach of the trial, and for the last chase the 0.2 s, 2 s and 3 s lines,
	 * reach, and 5 tiles at the end. A disagreement with a margin under about 0.3 is two sampling
	 * rates (20 and 60 frames a second) landing on either side of a line, not two readings of the
	 * definition.
	 */
	margin: number;
	marginAt: string;
}

interface Going {
	ghost: string;
	sum: number;
	low: number;
	at: number;
	left: number;
	dist: number;
	since: number;
	chase: boolean;
}

export function auditTrial(scenes: Scene[], trial: AuditTrial): AuditResult {
	const chases: AuditChase[] = [];
	const going = new Map<string, Going>();
	const atEnd = new Map<string, number>();
	let endDist: number | null = null, endSeen = false;
	let died = false, caught = false;
	let moved = 0; // seconds of live play so far
	let margin = Infinity, marginAt = '';
	const near = (value: number, line: number, what: string) => { const gap = Math.abs(value - line); if (gap < margin) { margin = gap; marginAt = what; } };

	const stop = (g: Going, end: AuditChase['end']) => {
		going.delete(g.ghost);
		near(-g.low, MIN_GAIN, '3 tiles of own approach');
		if (g.chase) chases.push({ ghost: g.ghost, end, at: g.at, left: g.left, dist: g.dist, gain: -g.low, atEnd: null });
	};

	let prev: Scene | null = null;
	let lastLeft = trial.total;
	for (const scene of scenes) {
		const f = scene.frame;
		if (f.power.serial < trial.serial) { prev = scene; continue; }
		if (f.power.serial > trial.serial) break; // the next power-up: this trial is closed
		const on = f.power.endReason === null;
		const left = on ? f.power.left : -(f.t - f.power.endedAt);
		lastLeft = left;
		const ran = !on && f.power.endReason === 'expired';

		for (const e of f.events) {
			if (e.type === 'eat' && e.t >= trial.startedAt - 0.011 && (on || e.t <= f.power.endedAt + 0.011)) {
				const g = going.get(e.ghost);
				chases.push({ ghost: e.ghost, end: 'eat', at: e.t, left: e.left, dist: 0, gain: g ? -g.low : 0, atEnd: null });
				going.clear(); // an eat ends every approach under way
			} else if (e.type === 'die' && ran) {
				died = true;
				const killer = f.ghosts.find((g) => g.id === e.by);
				caught = !!killer && Math.abs(killer.revertedAt - f.power.endedAt) < 0.011;
			}
		}
		if (!on && !ran) break; // died, cleared or refreshed: no end to judge

		// The moment the power ran out: how far is every ghost that just turned dangerous?
		if (ran && !endSeen) {
			endSeen = true;
			// Nothing becomes a chase after the end: approaches that are not one by now are dropped.
			for (const g of [...going.values()]) {
				// How close to 3 tiles each approach was when the power ran out decides whether it is a chase at all.
				near(-g.low, MIN_GAIN, '3 tiles of own approach by the end of the power');
				if (!g.chase) going.delete(g.ghost);
			}
			for (const g of f.ghosts) {
				if (g.mode !== 'active' || Math.abs(g.revertedAt - f.power.endedAt) > 0.011) continue;
				const d = pathBetween(scene.maze, f.player.x, f.player.y, g.x, g.y);
				if (!Number.isFinite(d)) continue;
				atEnd.set(g.id, d);
				endDist = Math.min(endDist ?? Infinity, d);
			}
		}
		if (died) break;

		const live = f.phase === 'playing' && prev !== null && f.t > prev.frame.t + 1e-9 && prev.frame.power.serial === trial.serial && prev.maze === scene.maze;
		if (live) {
			moved += f.t - prev!.frame.t;
			const was = prev!.frame.player;
			for (const g of f.ghosts) {
				const target = g.mode === 'active' && (on ? g.scared : Math.abs(g.revertedAt - f.power.endedAt) < 0.011);
				const d = target ? pathBetween(scene.maze, f.player.x, f.player.y, g.x, g.y) : Infinity;
				let cur = going.get(g.id);
				if (!target || !Number.isFinite(d)) { if (cur) stop(cur, 'turn'); continue; }
				// The player's own step: how the distance to where the ghost is now changed because the player moved.
				const before = pathBetween(scene.maze, was.x, was.y, g.x, g.y);
				const step = Number.isFinite(before) ? d - before : 0;
				if (!cur) {
					if (!on || step > -1e-4 || d > RANGE) continue;
					cur = { ghost: g.id, sum: step, low: step, at: f.t, left, dist: d, since: moved, chase: false };
					going.set(g.id, cur);
				} else {
					cur.sum += step;
					if (cur.sum < cur.low - 1e-9) { cur.low = cur.sum; cur.at = f.t; cur.left = left; cur.dist = d; cur.since = moved; }
				}
				if (on && -cur.low >= MIN_GAIN) cur.chase = true; // only while the ghost is edible
				if (cur.sum - cur.low >= BACK_OFF || moved - cur.since >= STALL || (on && d > RANGE)) stop(cur, 'turn');
			}
		}
		prev = scene;
	}
	// Still going at a ghost when the trial closed: that chase never turned.
	for (const g of [...going.values()]) stop(g, 'open');
	for (const c of chases) if (c.end !== 'eat') c.atEnd = atEnd.get(c.ghost) ?? null;

	// The final decision. First the chases still running when the power ran out (turned at or after
	// the end, or never): the nearest of their ghosts at that moment. Otherwise the latest turn-away.
	let last: AuditChase | null = null;
	const running = chases.filter((c) => c.end !== 'eat' && (c.end === 'open' || c.left <= 0) && c.atEnd !== null);
	if (trial.endReason === 'expired' && running.length) last = running.reduce((a, c) => (c.atEnd! < a.atEnd! ? c : a));
	else for (const c of chases) {
		if (!last) { last = c; continue; }
		const a = c.end === 'open' ? Infinity : c.at, b = last.end === 'open' ? Infinity : last.at;
		const together = a === b || Math.abs(a - b) <= 0.001;
		if (together ? c.dist < last.dist : a > b) last = c;
	}

	const expired = trial.endReason === 'expired';
	const window = Math.min(WINDOW, trial.total);
	const engaged = chases.some((c) => (c.end === 'open' ? Math.min(c.left, lastLeft) : c.left) <= window);

	const turned = !!last && last.end === 'turn';
	const reachable = turned && last!.left > 0 && last!.dist <= last!.left * PLAYER_SPEED;
	const gaveUpEarly = expired && !engaged && reachable && last!.left > IN_TIME[1];
	const inRates = expired && trial.cut !== 'quit' && (engaged || gaveUpEarly);

	let outcome: string;
	if (!expired) outcome = 'interrupted';
	else if (caught && endDist !== null && endDist <= NEAR_AT_END) outcome = 'caught';
	else if (!last) outcome = 'not-engaged';
	else if (last.end === 'eat') outcome = engaged ? 'catch' : 'not-engaged';
	else if (last.end === 'open' || last.left < IN_TIME[0]) outcome = last.atEnd !== null && last.atEnd <= NEAR_AT_END ? 'overstayed' : 'other';
	else if (!reachable) outcome = engaged ? 'other' : 'not-engaged';
	else outcome = last.left <= IN_TIME[1] ? 'timely-retreat' : 'early-retreat';

	if (expired) {
		if (caught && endDist !== null) near(endDist, NEAR_AT_END, '5 tiles at the end (caught)');
		if (last && last.end !== 'open') near(last.left, window, 'the 3 s window');
		if (last && last.end !== 'eat') {
			if (last.end === 'turn') {
				near(last.left, IN_TIME[0], 'the 0.2 s line');
				near(last.left, IN_TIME[1], 'the 2 s line');
				if (last.left > 0) near(last.dist, last.left * PLAYER_SPEED, 'reach');
			}
			if ((last.end === 'open' || last.left < IN_TIME[0] + 0.06) && last.atEnd !== null) near(last.atEnd, NEAR_AT_END, '5 tiles at the end');
		}
	}
	return { outcome, engaged, inRates, gaveUpEarly, chases, last, endDist, died, caught, margin, marginAt };
}
