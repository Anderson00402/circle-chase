import { DIRS, PATH, type Dir, type Facing, type Frame, type GhostView, type Maze } from '../types';
import { DOT_PAUSE, makeRng, type EngineGame } from './game';
import { pathDistances, tileOf } from './paths';

/**
 * A simulated player. Used for attract-mode previews, automated tests and clearly labelled
 * simulated data (never mixed with human data: a bot cannot see a cue).
 *
 * How it plays, once per tile (the tile it is about to reach):
 * - Danger map: for every tile, how soon a dangerous ghost could stand there. Each ghost counts
 *   fully within a few tiles and along its own predicted route (ghost steering is deterministic
 *   for a target); further out it counts as slower, except the two that home in on the player.
 * - Search: breadth-first from the decision tile over tiles it reaches with a safety margin, and
 *   into a corridor only if it can reach the far end before any ghost could.
 * - Choice: the move with the best discounted reward (dots, power dots, the bonus, scared ghosts
 *   it believes it can still catch) plus a bonus for safe room. It keeps going rather than
 *   turning back unless cornered; when cornered it takes the route with the widest margin.
 * - `skill` below 1 swaps in a random move now and then. Deterministic for a seed.
 *
 * Time awareness: at each power-up the bot draws an error from a normal distribution with
 * `awarenessNoise` seconds of spread. It believes the power has (true time left + error) and
 * chases scared ghosts only while that belief, minus `caution`, leaves time to reach them. It
 * notices a ghost has turned dangerous again `reaction` seconds after it happens.
 */
export interface BotOptions {
	seed: number;
	/** 0-1: how often it takes the best move rather than a random one. */
	skill: number;
	/** Spread (standard deviation, seconds) of the bot's error about the power time left. 0 = knows exactly. */
	awarenessNoise: number;
	/** Seconds of safety margin it keeps before it believes the power ends. */
	caution: number;
	/** Seconds it takes to notice that a ghost has turned dangerous again. */
	reaction: number;
	/** Debug: called with every plan (tile, scores per direction, chosen direction). */
	onPlan?: (p: { t: number; x: number; y: number; value: number[]; room: number[]; best: Dir; cornered: boolean }) => void;
}

export const DEFAULT_BOT: BotOptions = { seed: 1, skill: 1, awarenessNoise: 0, caution: 0.5, reaction: 0.3 };

export interface Bot {
	readonly options: BotOptions;
	/** Look at the game and steer. Call once before each `game.update`. */
	step(): void;
	/** Seconds of power the bot believes are left (0 when it believes none). */
	believedLeft(): number;
	/** The error drawn for the current power-up, in seconds (positive = thinks it has more time). */
	readonly error: number;
}

const REWARD = { dot: 1, power: 2.5, powerIdle: 0.4, bonus: 6, ghost: 12 };
const DISCOUNT = 0.93;
const SAFETY = 0.35; // seconds the bot wants between itself and a ghost at any tile on its path
const RETHINK = 0.12; // seconds between plans when nothing else forces one
const REVERSE_LOCK = 0.4; // after turning back, it does not turn back again this soon unless cornered
const NEAR = 4; // tiles around a ghost where any move it could make counts as danger
const AHEAD = 40; // tiles of a ghost's predicted route that count as danger
const ROOM_WEIGHT = 1, ROOM_FULL = 60; // how much open, safe space is worth next to food
const HAVEN = 0.8; // seconds ahead of every ghost that count as safe ground when fleeing
const SLACK = 1.6; // beyond NEAR, a ghost is assumed to take this much longer than the shortest path

export function createBot(game: EngineGame, partial: Partial<BotOptions> = {}): Bot {
	const options: BotOptions = { ...DEFAULT_BOT, ...partial };
	const rng = makeRng(options.seed * 7919 + 13);
	let serial = 0, error = 0;
	let lastKey = '', lastPlan = -1, lastReverse = -Infinity;

	function gauss() {
		const u = Math.max(1e-9, rng()), v = rng();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	}

	function believedLeft(f: Frame = game.peek()): number {
		const p = f.power;
		if (p.serial === 0 || p.startedAt < 0) return 0;
		// It does not know when the power will end; it only remembers when it started.
		const ended = p.left <= 0 && p.endReason !== 'expired';
		if (ended) return 0;
		return Math.max(0, p.total + error - (f.t - p.startedAt));
	}

	function step() {
		const f = game.peek();
		if (f.power.serial !== serial) {
			serial = f.power.serial;
			error = options.awarenessNoise > 0 ? gauss() * options.awarenessNoise : 0;
		}
		if (f.phase !== 'playing') return;
		const m = game.maze;
		const [dx, dy, dir] = decisionTile(m, f);
		const key = `${dx},${dy},${dir}`;
		if (key === lastKey && f.t - lastPlan < RETHINK) return;
		lastKey = key;
		lastPlan = f.t;
		const d = plan(m, f, dx, dy, dir);
		if (d < 0) return;
		if (f.player.moving && dir >= 0 && d === (dir + 2) % 4) lastReverse = f.t;
		game.steer(d as Facing);
	}

	function plan(m: Maze, f: Frame, sx: number, sy: number, dir: Dir): Dir {
		const info = game.info;
		// Effective speed: eating dots costs a moment per tile, so count it in.
		const ps = 1 / (1 / (f.power.left > 0 ? info.playerPowerSpeed : info.playerSpeed) + DOT_PAUSE);
		const belief = believedLeft(f);
		const n = m.W * m.H;
		const shape = shapeOf(m);

		// Who is dangerous: normal ghosts on the board, plus scared ones the bot thinks are about to turn.
		// Two views of danger, in seconds until a ghost could stand on each tile:
		// `danger` is the likely one (its own route, anything close by, the rest only slowly),
		// `worst` assumes every ghost comes straight for each tile; used before committing to a corridor.
		const danger = new Float32Array(n).fill(Infinity), worst = new Float32Array(n).fill(Infinity);
		const prey: { g: GhostView; i: number }[] = [];
		for (const g of f.ghosts) {
			if (g.mode === 'returning') continue;
			const [gx, gy] = tileOf(m, g.x, g.y);
			if (gy < 0 || gy >= m.H) continue;
			// A ghost that just turned back is still taken for scared until the bot notices.
			const looksScared = g.scared || (g.revertedAt >= 0 && f.t - g.revertedAt < options.reaction);
			if (looksScared && belief - options.caution > 0) {
				if (g.mode === 'active' && m.tiles[gy * m.W + gx] === PATH) prey.push({ g, i: gy * m.W + gx });
				continue;
			}
			if (g.mode !== 'active') {
				// In the pen: only matters once it is out, so count from the exit.
				spread(m, danger, worst, m.exit[0], m.exit[1], -1, 1, info.ghostSpeed, SLACK);
				continue;
			}
			// The hunter may hurry near the end of a level; assume the worst for it.
			const speed = g.id === 'hunter' ? Math.max(info.ghostSpeed, info.hurrySpeed2) : info.ghostSpeed;
			// Close by it could go anywhere; further out it follows its own steering rule. The two
			// that home in on the player (while chasing: target on the board) get no benefit of the doubt.
			const target = game.targetOf(g.id);
			const chasing = !g.scared && target[0] >= 0 && target[0] < m.W && target[1] >= 0 && target[1] < m.H;
			const direct = chasing && (g.id === 'hunter' || g.id === 'ambusher');
			spread(m, danger, worst, gx, gy, g.dir, 0, speed, direct ? 1 : SLACK);
			if (!g.scared) follow(m, danger, g, target, speed);
		}

		// Breadth-first search from the decision tile over tiles the player reaches safely.
		// Careful mode also refuses a corridor unless the bot can reach its far end before any ghost.
		const dist = new Int16Array(n), first = new Int8Array(n), queue = new Int32Array(n);
		const s = sy * m.W + sx;
		const lead = 0.15; // the player is not quite at the decision tile yet
		const startSafe = danger[s] - lead > SAFETY * 0.5;
		let tail = 0;
		function search(careful: boolean) {
			dist.fill(-1);
			first.fill(-1);
			let head = 0;
			tail = 0;
			dist[s] = 0;
			queue[tail++] = s;
			while (head < tail) {
				const i = queue[head++], x = i % m.W, y = (i / m.W) | 0;
				for (let d = 0; d < 4; d++) {
					const ny = y + DIRS[d].y;
					if (ny < 0 || ny >= m.H) continue;
					const j = ny * m.W + (x + DIRS[d].x + m.W) % m.W;
					if (dist[j] >= 0 || m.tiles[j] !== PATH) continue;
					const k = dist[i] + 1;
					if (danger[j] - (k / ps + lead) < SAFETY) continue;
					if (careful && shape.deg[j] === 2 && (shape.deg[i] !== 2 || i === s)) {
						const [e, len] = corridor(m, shape, i, d);
						if (worst[e] - ((dist[i] + len) / ps + lead) < SAFETY * 0.5) continue;
					}
					dist[j] = k;
					first[j] = i === s ? d : first[i];
					queue[tail++] = j;
				}
			}
		}

		// Score each first move by its best discounted reward, and count the safe room behind it.
		const value = [-Infinity, -Infinity, -Infinity, -Infinity];
		const room = [0, 0, 0, 0];
		const powerUseful = f.power.left <= 0 && f.ghosts.some((g) => g.mode === 'active' && !g.scared);
		// Scared ghosts are worth chasing only if the bot believes it can get there in time.
		const chaseSpeed = Math.max(0.5, ps - info.ghostScaredSpeed * 0.5);
		function score(): boolean {
			value.fill(-Infinity);
			room.fill(0);
			let any = false;
			const take = (d: number, r: number, k: number) => {
				value[d] = Math.max(value[d], r * DISCOUNT ** k);
				any = true;
			};
			for (let q = 1; q < tail; q++) {
				const j = queue[q], d = first[j];
				room[d]++;
				const pick = game.dots[j];
				let r = pick === 1 ? REWARD.dot : pick === 2 ? (powerUseful ? REWARD.power : REWARD.powerIdle) : 0;
				if (f.bonus && j === f.bonus.y * m.W + f.bonus.x) r += REWARD.bonus;
				if (r > 0) take(d, r, dist[j]);
			}
			for (const { i } of prey)
				if (dist[i] >= 0 && belief - options.caution > dist[i] / chaseSpeed) take(first[i], REWARD.ghost, dist[i]);
			return any;
		}
		// Careful first; if that leaves nothing to eat, accept corridors that are only safe as long
		// as the ghosts keep to their likely routes (otherwise the last dots would never get eaten).
		search(true);
		if (!score()) {
			search(false);
			score();
		}
		for (let d = 0; d < 4; d++) {
			if (room[d] === 0) continue;
			if (value[d] === -Infinity) value[d] = 0;
			// Prefer the side with more safe room; a small pocket is a trap the ghosts can close.
			value[d] += ROOM_WEIGHT * Math.min(1, room[d] / ROOM_FULL);
			if (room[d] < 8) value[d] -= 2;
		}

		const moves: Dir[] = [];
		for (let d = 0; d < 4; d++) if (open(m, sx, sy, d)) moves.push(d as Dir);
		if (!moves.length) return -1;
		// Keep going rather than turning back, unless cornered: avoids dithering between two plans.
		const moving = f.player.moving && dir >= 0;
		const back = moving ? (dir + 2) % 4 : -1;
		const forward = moves.filter((d) => d !== back);
		const choose = (pool: Dir[]) => {
			let b: Dir = -1, bv = -Infinity;
			for (const d of pool) if (value[d] > bv) { bv = value[d]; b = d; }
			return [b, bv] as const;
		};
		let [best, bestV] = choose(forward.length ? forward : moves);
		const cornered = !startSafe || bestV === -Infinity || bestV < -1;
		if (cornered && f.t - lastReverse > REVERSE_LOCK) {
			[best, bestV] = choose(moves);
			if (best < 0 || bestV === -Infinity || !startSafe) best = flee(m, danger, sx, sy, dir, moves, ps, lead);
		} else if (best < 0 || bestV === -Infinity) best = flee(m, danger, sx, sy, dir, forward.length ? forward : moves, ps, lead);

		options.onPlan?.({ t: f.t, x: sx, y: sy, value: value.slice(), room: room.slice(), best, cornered });
		// Imperfect play: now and then a random (non-reversing) move instead.
		if (options.skill < 1 && rng() > options.skill) {
			const ahead = moves.filter((d) => d !== ((dir + 2) % 4));
			const pool = ahead.length ? ahead : moves;
			best = pool[Math.floor(rng() * pool.length)];
		}
		return best;
	}

	return {
		options,
		step,
		believedLeft: () => believedLeft(),
		get error() { return error; }
	};
}

interface Shape {
	/** Open neighbours of each tile (tunnels wrap). */
	deg: Uint8Array;
	/** (tile * 4 + dir) -> [junction at the far end of the corridor, steps to it]. */
	seg: Map<number, [number, number]>;
}
const shapes = new WeakMap<Maze, Shape>();
function shapeOf(m: Maze): Shape {
	let s = shapes.get(m);
	if (s) return s;
	const deg = new Uint8Array(m.W * m.H);
	for (let i = 0; i < deg.length; i++) {
		if (m.tiles[i] !== PATH) continue;
		const x = i % m.W, y = (i / m.W) | 0;
		for (let d = 0; d < 4; d++) if (open(m, x, y, d)) deg[i]++;
	}
	shapes.set(m, (s = { deg, seg: new Map() }));
	return s;
}

/** Walks from tile `i` in direction `d` along a corridor to the next junction. */
function corridor(m: Maze, shape: Shape, i: number, d: number): [number, number] {
	const key = i * 4 + d;
	const hit = shape.seg.get(key);
	if (hit) return hit;
	let x = i % m.W, y = (i / m.W) | 0, dir = d, len = 0;
	do {
		x = (x + DIRS[dir].x + m.W) % m.W;
		y += DIRS[dir].y;
		len++;
		if (shape.deg[y * m.W + x] !== 2) break;
		for (let nd = 0; nd < 4; nd++) if (nd !== (dir + 2) % 4 && open(m, x, y, nd)) { dir = nd; break; }
	} while (len < m.W * m.H);
	const out: [number, number] = [y * m.W + x, len];
	shape.seg.set(key, out);
	return out;
}

/**
 * Cornered: pick the move whose best route to a safe haven (a tile the bot reaches well before any
 * ghost) has the widest margin at its tightest point. Margins use shortest-path arrival times.
 */
function flee(m: Maze, danger: Float32Array, x: number, y: number, dir: Dir, moves: Dir[], ps: number, lead: number): Dir {
	const n = m.W * m.H, s = y * m.W + x;
	const steps = pathDistances(m, [x, y]);
	const margin = (j: number) => Math.min(3, danger[j] - (steps[j] / ps + lead));
	// Widest path: b[j] = the best "tightest margin" over routes from the start to j.
	const b = new Float32Array(n).fill(-Infinity), first = new Int8Array(n).fill(-1), done = new Uint8Array(n);
	const heap: number[] = [];
	const push = (j: number) => {
		heap.push(j);
		for (let i = heap.length - 1; i > 0;) {
			const p = (i - 1) >> 1;
			if (b[heap[p]] >= b[heap[i]]) break;
			[heap[p], heap[i]] = [heap[i], heap[p]];
			i = p;
		}
	};
	const pop = () => {
		const top = heap[0], last = heap.pop()!;
		if (heap.length) {
			heap[0] = last;
			for (let i = 0; ;) {
				const l = 2 * i + 1, r = l + 1;
				let k = i;
				if (l < heap.length && b[heap[l]] > b[heap[k]]) k = l;
				if (r < heap.length && b[heap[r]] > b[heap[k]]) k = r;
				if (k === i) break;
				[heap[k], heap[i]] = [heap[i], heap[k]];
				i = k;
			}
		}
		return top;
	};
	done[s] = 1;
	for (const d of moves) {
		const j = (y + DIRS[d].y) * m.W + (x + DIRS[d].x + m.W) % m.W;
		b[j] = margin(j);
		first[j] = d;
		push(j);
	}
	const score = [-Infinity, -Infinity, -Infinity, -Infinity];
	while (heap.length) {
		const i = pop();
		if (done[i]) continue;
		done[i] = 1;
		const d = first[i];
		if (margin(i) >= HAVEN) score[d] = Math.max(score[d], b[i]);
		else score[d] = Math.max(score[d], b[i] - 10);
		const cx = i % m.W, cy = (i / m.W) | 0;
		for (let e = 0; e < 4; e++) {
			const ny = cy + DIRS[e].y;
			if (ny < 0 || ny >= m.H) continue;
			const j = ny * m.W + (cx + DIRS[e].x + m.W) % m.W;
			if (done[j] || m.tiles[j] !== PATH) continue;
			const v = Math.min(b[i], margin(j));
			if (v > b[j]) { b[j] = v; first[j] = d; push(j); }
		}
	}
	let best = moves[0], bestV = -Infinity;
	for (const d of moves) {
		const v = score[d] + (d === dir ? 0.05 : 0); // a small nudge to keep going: no dithering
		if (v > bestV) { bestV = v; best = d; }
	}
	return best;
}

/**
 * Folds one ghost into the danger maps by shortest paths: fully into `worst`; into `danger` fully
 * within NEAR tiles and slowed down by SLACK further out (it may come, but probably not straight).
 */
function spread(m: Maze, danger: Float32Array, worst: Float32Array, gx: number, gy: number, gdir: Dir, delay: number, speed: number, slack: number) {
	const dist = pathDistancesNoReverse(m, gx, gy, gdir);
	for (let i = 0; i < dist.length; i++) {
		if (dist[i] < 0) continue;
		const t = delay + dist[i] / speed;
		worst[i] = Math.min(worst[i], t);
		danger[i] = Math.min(danger[i], dist[i] <= NEAR ? t : delay + (NEAR + (dist[i] - NEAR) * slack) / speed);
	}
}

/**
 * Follows a ghost's own steering rule (no turning back, at each crossing the step that brings it
 * closest to its target in a straight line) and marks when it reaches each tile on the way.
 */
function follow(m: Maze, danger: Float32Array, g: GhostView, target: [number, number], speed: number) {
	if (g.dir < 0) return;
	const d0 = DIRS[g.dir];
	// The tile it is leaving and how far along it is.
	let fx = d0.x > 0 ? Math.floor(g.x) : d0.x < 0 ? Math.ceil(g.x) : Math.round(g.x);
	let fy = d0.y > 0 ? Math.floor(g.y) : d0.y < 0 ? Math.ceil(g.y) : Math.round(g.y);
	const done = Math.abs(g.x - fx) + Math.abs(g.y - fy);
	fx = ((fx % m.W) + m.W) % m.W;
	let x = (fx + d0.x + m.W) % m.W, y = fy + d0.y, dir: number = g.dir;
	if (y < 0 || y >= m.H || m.tiles[y * m.W + x] !== PATH) return;
	let t = (1 - done) / speed;
	const [tx, ty] = target;
	for (let n = 0; n < AHEAD; n++) {
		const i = y * m.W + x;
		danger[i] = Math.min(danger[i], t);
		let best = -1, bestD = Infinity;
		for (let d = 0; d < 4; d++) {
			if (d === (dir + 2) % 4) continue;
			const nx = (x + DIRS[d].x + m.W) % m.W, ny = y + DIRS[d].y;
			if (ny < 0 || ny >= m.H || m.tiles[ny * m.W + nx] !== PATH) continue;
			const dd = (x + DIRS[d].x - tx) ** 2 + (ny - ty) ** 2;
			if (dd < bestD) { bestD = dd; best = d; }
		}
		if (best < 0) return;
		x = (x + DIRS[best].x + m.W) % m.W;
		y += DIRS[best].y;
		dir = best;
		t += 1 / speed;
	}
}

function pathDistancesNoReverse(m: Maze, x: number, y: number, dir: Dir): Int16Array {
	if (dir < 0) return pathDistances(m, [x, y]);
	const n = m.W * m.H, dist = new Int16Array(n).fill(-1), queue = new Int32Array(n);
	let head = 0, tail = 0;
	const s = y * m.W + x;
	dist[s] = 0;
	queue[tail++] = s;
	const back = (dir + 2) % 4;
	while (head < tail) {
		const i = queue[head++], cx = i % m.W, cy = (i / m.W) | 0;
		for (let d = 0; d < 4; d++) {
			if (i === s && d === back) continue;
			const ny = cy + DIRS[d].y;
			if (ny < 0 || ny >= m.H) continue;
			const j = ny * m.W + (cx + DIRS[d].x + m.W) % m.W;
			if (dist[j] >= 0 || m.tiles[j] !== PATH) continue;
			dist[j] = dist[i] + 1;
			queue[tail++] = j;
		}
	}
	// The tile right behind it is still close: it can turn around after one step.
	const bj = (y + DIRS[back].y) * m.W + (x + DIRS[back].x + m.W) % m.W;
	if (bj >= 0 && bj < n && m.tiles[bj] === PATH && (dist[bj] < 0 || dist[bj] > 3)) dist[bj] = 3;
	return dist;
}

const open = (m: Maze, x: number, y: number, d: number) => {
	const ny = y + DIRS[d].y;
	if (ny < 0 || ny >= m.H) return false;
	return m.tiles[ny * m.W + (x + DIRS[d].x + m.W) % m.W] === PATH;
};

/** The tile where the player's next turn can happen, and its direction. */
function decisionTile(m: Maze, f: Frame): [number, number, Dir] {
	const { x, y, dir, moving } = f.player;
	if (!moving || dir < 0) {
		const [tx, ty] = tileOf(m, x, y);
		return [tx, ty, dir];
	}
	const e = 1e-6;
	let tx = x, ty = y;
	if (dir === 3) tx = Math.ceil(x - e);
	else if (dir === 1) tx = Math.floor(x + e);
	else if (dir === 2) ty = Math.ceil(y - e);
	else ty = Math.floor(y + e);
	const [wx, wy] = tileOf(m, tx, ty);
	// Mid-corridor with the next tile still ahead: plan from there.
	if (m.tiles[wy * m.W + wx] !== PATH) return [...tileOf(m, x, y), dir];
	return [wx, wy, dir];
}
