import {
	DIRS, DOOR, PATH, PEN, WALL, GHOST_IDS,
	type Dir, type Facing, type Frame, type Game, type GameConfig, type GameEvent,
	type GhostId, type GhostMode, type Maze, type Popup, type PowerEndReason, type Scene
} from '../types';
import { flood, mazeForLevel } from './mazes';
import { DIFFICULTY, levelInfo, type LevelInfo } from './levels';

/** Game rules. No page access here, so the same code runs in tests, bots and the browser. */

export { DIFFICULTY, type DifficultyDef } from './levels';

/** Player speed on level 1, normal (tiles per second). Kept for older callers; see `levelInfo`. */
export const PLAYER_SPEED = levelInfo(1).playerSpeed;
export const READY_TIME = 1.8, DEATH_TIME = 1.6, CLEAR_TIME = 2.2;
const TURN_MEMORY = 0.5; // seconds an early key press is kept
/** How far before a tile centre (in tiles) the player may already start a turn. Ghosts never do. */
export const CORNER_WINDOW = 0.35;
const EAT_FREEZE = 0.35; // the board holds still for a moment when a ghost is eaten
const DOT_PAUSE = 1 / 60, POWER_PAUSE = 3 / 60; // the player loses a moment for each dot eaten
const HIT_RADIUS2 = 0.36; // squared distance in tiles at which player and ghost touch
const BONUS_AT = [0.3, 0.7]; // share of the level's dots eaten at which the bonus item appears
const EXTRA_LIFE_AT = 10000;
const POWER_POINTS = 50, DOT_POINTS = 10;
const RESPAWN_CLEARANCE = 3; // a power dot does not grow back right under the player

/** Scatter corners as fractions of the maze; targets sit just outside so ghosts circle the corner. */
const CORNERS: Record<GhostId, [number, number]> = {
	hunter: [1, 0], ambusher: [0, 0], guard: [0, 1], drifter: [1, 1]
};

export const DEFAULT_CONFIG: GameConfig = {
	mode: 'arcade', difficulty: 'normal', seed: 1, startLevel: 1,
	frightRange: null, powerRespawn: 0, infiniteLives: false
};
/** Study mode: random power lengths, power dots that grow back, and no game over. */
export const STUDY_CONFIG: GameConfig = {
	mode: 'study', difficulty: 'normal', seed: 1, startLevel: 1,
	frightRange: [4, 8], powerRespawn: 12, infiniteLives: true
};

/** Small seeded random number generator (mulberry32). */
export function makeRng(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6d2b79f5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The game as the engine builds it: the shared `Game` contract plus a few engine extras. */
export interface EngineGame extends Game {
	/** Snapshot without handing over the pending events (for bots and debug views). */
	peek(): Frame;
	/** Speeds, power length, maze and so on for the current level. */
	readonly info: LevelInfo;
	/** Jump straight to the READY screen of a level (debug views, previews, tests). Keeps the score. */
	goToLevel(level: number): void;
}

interface Mover { x: number; y: number; t: number; dir: Dir }
interface Player extends Mover {
	face: Facing;
	/** Leftover offset from a corner cut short, shrinking to zero as the player moves on. */
	ox: number;
	oy: number;
}
interface Ghost extends Mover {
	id: GhostId;
	index: number;
	mode: GhostMode;
	scared: boolean;
	/** Reverse at the next chance (mode change, power-up start). */
	flip: boolean;
	/** Dots eaten while this ghost was first in line to leave the pen. */
	dots: number;
	revertedAt: number;
	eatenAt: number;
	/** Drifter: current wander target and when to pick a new one. */
	wander: [number, number];
	wanderAt: number;
}

/** A game event without its time stamp. */
type EventBody = GameEvent extends infer E ? (E extends unknown ? Omit<E, 't'> : never) : never;

const rev = (d: Dir): Dir => (d < 0 ? -1 : (((d + 2) % 4) as Dir));

export function createGame(partial: Partial<GameConfig> = {}): EngineGame {
	const config: GameConfig = { ...DEFAULT_CONFIG, ...partial };
	if (!(config.difficulty in DIFFICULTY)) config.difficulty = 'normal';
	const rng = makeRng(config.seed);

	let m: Maze, dots: Uint8Array, lv: LevelInfo;
	let dotsLeft = 0, smallLeft = 0, smallTotal = 0, smallEaten = 0;
	let distExit: Int16Array, distHome: Int16Array, tunnel: Uint8Array;
	let level = Math.max(1, config.startLevel | 0), score = 0, lives = DIFFICULTY[config.difficulty].lives;
	let deaths = 0, extraGiven = false;
	let phase: Frame['phase'] = 'ready', phaseTime = 0, time = 0;
	let player: Player, ghosts: Ghost[] = [];
	let want: Dir = -1, wantAge = 0, eatPause = 0;
	let powerOn = false, fright = 0, frightTotal = 0, chain = 0, powerSerial = 0;
	let powerStartedAt = -1, powerEndedAt = -1, powerEndReason: PowerEndReason | null = null;
	let hitStop = 0, modeIndex = 0, modeTime = 0;
	// Pen release: per-ghost dot counts, or one shared count after a death; plus an idle timer.
	let sharedCount = false, sharedDots = 0, idle = 0, hurryHeld = false;
	let popups: Popup[] = [], events: GameEvent[] = [];
	let respawns: { i: number; at: number }[] = [];
	let bonus: { kind: number; points: number; left: number } | null = null, bonusShown = 0;

	const emit = (e: EventBody) => events.push({ t: time, ...e } as GameEvent);
	const wrapX = (x: number) => ((x % m.W) + m.W) % m.W;
	const tileAt = (x: number, y: number) => (y < 0 || y >= m.H ? WALL : m.tiles[y * m.W + wrapX(x)]);
	const wave = (): 'scatter' | 'chase' => (modeIndex % 2 === 0 ? 'scatter' : 'chase');
	const setPhase = (p: Frame['phase']) => { phase = p; phaseTime = 0; };
	const pos = (e: Mover): [number, number] => {
		if (e.dir < 0) return [e.x, e.y];
		const d = DIRS[e.dir];
		return [e.x + d.x * e.t, e.y + d.y * e.t];
	};

	function loadLevel() {
		m = mazeForLevel(level);
		lv = levelInfo(level, config.difficulty);
		dots = m.dotsInit.slice();
		dotsLeft = m.dotTotal;
		smallTotal = 0;
		for (let i = 0; i < dots.length; i++) if (dots[i] === 1) smallTotal++;
		smallLeft = smallTotal;
		smallEaten = 0;
		distExit = flood(m, m.exit);
		distHome = flood(m, m.home);
		tunnel = tunnelTiles(m);
		respawns = [];
		bonus = null;
		bonusShown = 0;
		sharedCount = false;
		resetActors();
		for (const g of ghosts) g.dots = 0;
	}

	function resetActors() {
		player = { x: m.start[0], y: m.start[1], dir: 1, face: 1, t: 0, ox: 0, oy: 0 };
		ghosts = GHOST_IDS.map((id, i): Ghost => {
			const [x, y] = i === 0 ? m.exit : m.penSlots[(i - 1) % m.penSlots.length];
			return {
				id, index: i, x, y, t: 0, dir: i === 0 ? 1 : 0, mode: i === 0 ? 'active' : 'waiting',
				scared: false, flip: false, dots: ghosts[i]?.dots ?? 0,
				revertedAt: ghosts[i]?.revertedAt ?? -1, eatenAt: ghosts[i]?.eatenAt ?? -1,
				wander: [x, y], wanderAt: 0
			};
		});
		endPower('died');
		want = -1; wantAge = 0; eatPause = 0; chain = 0; hitStop = 0; modeIndex = 0; modeTime = 0; idle = 0;
		bonus = null;
	}

	function addScore(n: number) {
		score += n;
		if (!extraGiven && score >= EXTRA_LIFE_AT) { extraGiven = true; lives++; emit({ type: 'extra' }); }
	}

	// ---- power-up ----
	function startPower() {
		if (powerOn) endPower('refreshed');
		// Study mode: the length comes only from the range, so it is the same at every level.
		const range = config.frightRange;
		frightTotal = range ? range[0] + rng() * (range[1] - range[0]) : lv.powerTime;
		fright = frightTotal;
		powerOn = true;
		chain = 0;
		powerSerial++;
		powerStartedAt = time;
		powerEndReason = null;
		for (const g of ghosts) {
			if (g.mode === 'returning') continue;
			g.scared = true;
			if (g.mode === 'active') g.flip = true;
		}
	}

	function endPower(reason: PowerEndReason) {
		if (!powerOn) return;
		powerOn = false;
		fright = 0;
		powerEndedAt = time;
		powerEndReason = reason;
		for (const g of ghosts) {
			if (g.scared && reason === 'expired') g.revertedAt = time;
			g.scared = false;
		}
		emit({ type: 'powerEnd', reason });
	}

	// ---- main loop ----
	function update(dt: number) {
		for (const p of popups) p.age += dt;
		if (popups.length) popups = popups.filter((p) => p.age < 1);
		// Eating a ghost freezes the whole board, game time included.
		if (phase === 'playing' && hitStop > 0) { hitStop -= dt; return; }
		time += dt;
		phaseTime += dt;
		if (phase === 'ready') { if (phaseTime >= READY_TIME) setPhase('playing'); return; }
		if (phase === 'dying') {
			if (phaseTime < DEATH_TIME) return;
			if (lives <= 0) { setPhase('over'); emit({ type: 'over' }); }
			else {
				resetActors();
				sharedCount = true;
				sharedDots = 0;
				hurryHeld = true;
				setPhase('ready');
			}
			return;
		}
		if (phase === 'clear') {
			if (phaseTime >= CLEAR_TIME) { level++; loadLevel(); setPhase('ready'); emit({ type: 'level', level }); }
			return;
		}
		if (phase !== 'playing') return;
		step(dt);
	}

	function step(dt: number) {
		if (want >= 0 && (wantAge += dt) > TURN_MEMORY) want = -1;
		if (powerOn) {
			fright -= dt;
			if (fright <= 0) endPower('expired');
		} else if (modeIndex < lv.waves.length - 1) {
			// The scatter/chase clock stands still during a power-up.
			modeTime += dt;
			if (modeTime >= lv.waves[modeIndex]) {
				modeIndex++;
				modeTime = 0;
				for (const g of ghosts) if (g.mode === 'active') g.flip = true;
				emit({ type: 'mode', mode: wave() });
			}
		}
		idle += dt;
		releaseGhosts();
		tickPickups(dt);
		for (const g of ghosts) if (g.id === 'drifter' && time >= g.wanderAt) pickWander(g);

		movePlayer(dt);
		if (phase !== 'playing') return;
		checkHits();
		if (phase !== 'playing' || hitStop > 0) return;
		for (const g of ghosts) moveGhost(g, dt);
		checkHits();
	}

	/** Lets the next ghost out of the pen when its dot count is reached or the player stops eating. */
	function releaseGhosts() {
		const next = ghosts.find((g) => g.mode === 'waiting');
		if (!next) { sharedCount = false; hurryHeld = false; return; }
		const due = sharedCount ? sharedDots >= lv.releaseAfterDeath[next.index] : next.dots >= lv.releaseDots[next.index];
		if (due || idle >= lv.releaseIdle) {
			next.mode = 'leaving';
			if (!due) idle = 0;
		}
	}

	function tickPickups(dt: number) {
		if (bonus && (bonus.left -= dt) <= 0) bonus = null;
		if (!respawns.length) return;
		const [px, py] = pos(player);
		respawns = respawns.filter((r) => {
			if (time < r.at) return true;
			const x = r.i % m.W, y = (r.i / m.W) | 0;
			if (Math.abs(px - x) + Math.abs(py - y) < RESPAWN_CLEARANCE) return true;
			dots[r.i] = 2;
			dotsLeft++;
			emit({ type: 'powerRespawn', x, y });
			return false;
		});
	}

	// ---- player ----
	const open = (x: number, y: number, d: Dir) => d >= 0 && tileAt(x + DIRS[d].x, y + DIRS[d].y) === PATH;

	function movePlayer(dt: number) {
		const p = player;
		// Reversing is allowed at any moment.
		if (want >= 0 && p.dir >= 0 && want === rev(p.dir)) {
			if (p.t > 0) { const d = DIRS[p.dir]; p.x = wrapX(p.x + d.x); p.y += d.y; p.t = 1 - p.t; }
			p.dir = want; p.face = want as Facing; want = -1;
		}
		const lost = Math.min(dt, eatPause);
		eatPause -= lost;
		let dist = (powerOn ? lv.playerPowerSpeed : lv.playerSpeed) * (dt - lost);
		for (let n = 0; dist > 1e-9 && n < 8; n++) {
			if (p.t === 0) {
				if (want >= 0 && open(p.x, p.y, want)) { p.dir = want; want = -1; }
				else if (p.dir < 0 || !open(p.x, p.y, p.dir)) { p.dir = -1; break; }
				p.face = p.dir as Facing;
			} else if (want >= 0 && want !== p.dir && 1 - p.t <= CORNER_WINDOW) {
				// Cut the corner: jump the bookkeeping to the next tile and keep the leftover as an
				// offset that shrinks while the player already moves along the new corridor.
				const d = DIRS[p.dir], nx = wrapX(p.x + d.x), ny = p.y + d.y;
				if (open(nx, ny, want)) {
					p.ox -= d.x * (1 - p.t);
					p.oy -= d.y * (1 - p.t);
					p.x = nx; p.y = ny; p.t = 0;
					p.dir = want; p.face = want as Facing; want = -1;
				}
			}
			const s = Math.min(dist, 1 - p.t);
			p.t += s; dist -= s;
			p.ox = shrink(p.ox, s);
			p.oy = shrink(p.oy, s);
			if (p.t >= 1 - 1e-9) { const d = DIRS[p.dir]; p.x = wrapX(p.x + d.x); p.y += d.y; p.t = 0; }
		}
		// A pickup is eaten once the player is more than halfway onto its tile.
		const [px, py] = playerPos();
		eatAt(wrapX(Math.round(px)), Math.round(py));
	}
	const shrink = (v: number, s: number) => (v > 0 ? Math.max(0, v - s) : Math.min(0, v + s));
	const playerPos = (): [number, number] => {
		const [x, y] = pos(player);
		return [x + player.ox, y + player.oy];
	};

	function eatAt(x: number, y: number) {
		if (y < 0 || y >= m.H) return;
		const i = y * m.W + x;
		if (bonus && x === m.bonusTile[0] && y === m.bonusTile[1]) {
			addScore(bonus.points);
			popups.push({ x, y, text: '+' + bonus.points, age: 0 });
			emit({ type: 'bonus', points: bonus.points, x, y });
			bonus = null;
		}
		const d = dots[i];
		if (!d) return;
		dots[i] = 0;
		dotsLeft--;
		idle = 0;
		if (sharedCount) sharedDots++;
		else { const next = ghosts.find((g) => g.mode === 'waiting'); if (next) next.dots++; }
		if (d === 2) {
			addScore(POWER_POINTS);
			eatPause += POWER_PAUSE;
			startPower();
			emit({ type: 'power', x, y, total: frightTotal });
			if (config.powerRespawn > 0) respawns.push({ i, at: time + config.powerRespawn });
		} else {
			addScore(DOT_POINTS);
			eatPause += DOT_PAUSE;
			smallLeft--;
			smallEaten++;
			emit({ type: 'dot', x, y });
			if (bonusShown < BONUS_AT.length && smallEaten >= BONUS_AT[bonusShown] * smallTotal) {
				bonusShown++;
				bonus = { kind: lv.bonus.kind, points: lv.bonus.points, left: 9 + rng() };
				emit({ type: 'bonusShow', x: m.bonusTile[0], y: m.bonusTile[1], kind: bonus.kind });
			}
		}
		// The maze is clear when every small dot is gone. Power dots count too, unless they grow back.
		if (smallLeft === 0 && (config.powerRespawn > 0 || dotsLeft === 0)) {
			endPower('cleared');
			bonus = null;
			setPhase('clear');
			emit({ type: 'clear' });
		}
	}

	// ---- ghosts ----
	function ghostSpeed(g: Ghost) {
		if (g.mode === 'returning') return lv.eyesSpeed;
		if (g.mode === 'leaving' || g.mode === 'waiting') return lv.ghostPenSpeed;
		const inTunnel = tunnel[g.y * m.W + wrapX(g.x)] === 1;
		if (g.scared) return inTunnel ? Math.min(lv.ghostScaredSpeed, lv.ghostTunnelSpeed) : lv.ghostScaredSpeed;
		if (inTunnel) return lv.ghostTunnelSpeed;
		const h = hurry(g);
		return h === 2 ? lv.hurrySpeed2 : h === 1 ? lv.hurrySpeed : lv.ghostSpeed;
	}

	/** 0, 1 or 2: how much the hunter hurries near the end of a level. */
	function hurry(g: Ghost) {
		if (g.id !== 'hunter' || hurryHeld || lv.hurryDots <= 0) return 0;
		return smallLeft <= lv.hurryDots / 2 ? 2 : smallLeft <= lv.hurryDots ? 1 : 0;
	}

	function ghostCan(g: Ghost, d: number) {
		const t = tileAt(g.x + DIRS[d].x, g.y + DIRS[d].y);
		if (t === WALL) return false;
		if (t === DOOR || t === PEN) return g.mode === 'leaving' || g.mode === 'returning';
		return true;
	}

	function cornerOf(id: GhostId): [number, number] {
		const c = CORNERS[id];
		return [c[0] ? m.W + 1 : -2, c[1] ? m.H + 1 : -2];
	}

	/** Where a ghost is heading. Pure: reads the board, changes nothing. */
	function targetFor(g: Ghost): [number, number] {
		if (g.mode === 'returning') return m.home;
		if (g.mode !== 'active') return m.exit;
		const p = player, f = DIRS[p.face];
		const chase = wave() === 'chase' || hurry(g) > 0;
		if (!chase) return cornerOf(g.id);
		switch (g.id) {
			case 'hunter':
				// Straight at the player.
				return [p.x, p.y];
			case 'ambusher':
				// Aims four tiles ahead of where the player is facing, to cut them off.
				return [p.x + f.x * 4, p.y + f.y * 4];
			case 'guard': {
				// Keeps to its own area (the lower left); chases only while the player is inside it,
				// otherwise walks a slow loop around the area.
				const [ax, ay] = guardArea();
				const r = Math.max(m.W, m.H) * 0.34;
				if ((p.x - ax) ** 2 + (p.y - ay) ** 2 <= r * r) return [p.x, p.y];
				const k = Math.floor(time / 4) % 4, s = r * 0.6;
				return [ax + (k === 1 || k === 2 ? s : -s), ay + (k >= 2 ? s : -s)];
			}
			default:
				// Drifter: wanders between spots it picks every few seconds.
				return g.wander;
		}
	}
	const guardArea = (): [number, number] => [m.W * 0.27, m.H * 0.7];

	function pickWander(g: Ghost) {
		// Half the time somewhere near the player, half the time anywhere on the board.
		if (rng() < 0.5) g.wander = [player.x + Math.round(rng() * 12 - 6), player.y + Math.round(rng() * 12 - 6)];
		else g.wander = [Math.floor(rng() * m.W), Math.floor(rng() * m.H)];
		g.wanderAt = time + 2.5 + rng() * 2;
	}

	function chooseDir(g: Ghost): Dir {
		const choices: number[] = [];
		for (let d = 0; d < 4; d++) if (ghostCan(g, d)) choices.push(d);
		if (!choices.length) return -1;
		if (g.mode === 'leaving' || g.mode === 'returning') {
			const dist = g.mode === 'leaving' ? distExit : distHome;
			let best = choices[0], bestD = Infinity;
			for (const d of choices) {
				const n = dist[(g.y + DIRS[d].y) * m.W + wrapX(g.x + DIRS[d].x)];
				if (n >= 0 && n < bestD) { bestD = n; best = d; }
			}
			return best as Dir;
		}
		let pool = choices.filter((d) => d !== rev(g.dir));
		if (!pool.length) pool = choices;
		// Scared ghosts turn at random, the same way for the whole power-up.
		if (g.scared) return pool[Math.floor(rng() * pool.length)] as Dir;
		const [tx, ty] = targetFor(g);
		let best = pool[0], bestD = Infinity;
		for (const d of pool) {
			const dd = (g.x + DIRS[d].x - tx) ** 2 + (g.y + DIRS[d].y - ty) ** 2;
			if (dd < bestD) { bestD = dd; best = d; }
		}
		return best as Dir;
	}

	function flip(g: Ghost) {
		if (g.dir < 0) return;
		if (g.t > 0) { const d = DIRS[g.dir]; g.x = wrapX(g.x + d.x); g.y += d.y; g.t = 1 - g.t; }
		g.dir = rev(g.dir);
	}

	function arrive(g: Ghost) {
		if (g.mode === 'leaving' && g.x === m.exit[0] && g.y === m.exit[1]) {
			g.mode = 'active';
			g.dir = 1;
		} else if (g.mode === 'returning' && g.x === m.home[0] && g.y === m.home[1]) g.mode = 'leaving';
	}

	function moveGhost(g: Ghost, dt: number) {
		if (g.mode === 'waiting') return;
		if (g.flip) { g.flip = false; if (g.mode === 'active') flip(g); }
		let dist = ghostSpeed(g) * dt;
		for (let n = 0; dist > 1e-9 && n < 8; n++) {
			if (g.t === 0) {
				arrive(g);
				g.dir = chooseDir(g);
				if (g.dir < 0) return;
			}
			const s = Math.min(dist, 1 - g.t);
			g.t += s; dist -= s;
			if (g.t >= 1 - 1e-9) { const d = DIRS[g.dir]; g.x = wrapX(g.x + d.x); g.y += d.y; g.t = 0; }
		}
	}

	function checkHits() {
		const [px, py] = playerPos();
		for (const g of ghosts) {
			if (g.mode !== 'active') continue;
			const [gx, gy] = pos(g);
			let dx = Math.abs(px - gx);
			dx = Math.min(dx, m.W - dx);
			const dy = py - gy;
			if (dx * dx + dy * dy > HIT_RADIUS2) continue;
			if (g.scared) {
				chain = Math.min(chain + 1, 4);
				const points = 100 * 2 ** chain;
				addScore(points);
				g.scared = false;
				g.mode = 'returning';
				g.eatenAt = time;
				hitStop = EAT_FREEZE;
				popups.push({ x: gx, y: gy, text: '+' + points, age: 0 });
				emit({ type: 'eat', ghost: g.id, points, x: gx, y: gy, left: fright });
				continue;
			}
			deaths++;
			if (!config.infiniteLives) lives--;
			emit({ type: 'die', by: g.id });
			endPower('died');
			setPhase('dying');
			return;
		}
	}

	function snapshot(): Frame {
		const [px, py] = playerPos();
		return {
			t: time, phase, phaseTime, level, mazeId: m.id, score, lives, dotsLeft,
			player: { x: px, y: py, dir: player.dir, face: player.face, moving: player.dir >= 0 },
			ghosts: ghosts.map((g) => {
				let [x, y] = pos(g);
				// Waiting ghosts bob up and down in the pen (driven by game time, so replays match).
				if (g.mode === 'waiting') y += 0.2 * Math.sin(time * 5 + g.index * 2);
				return { id: g.id, x, y, dir: g.dir, mode: g.mode, scared: g.scared, revertedAt: g.revertedAt, eatenAt: g.eatenAt };
			}),
			power: {
				left: powerOn ? fright : 0, total: frightTotal, startedAt: powerStartedAt, endedAt: powerEndedAt,
				endReason: powerEndReason, chain, serial: powerSerial
			},
			bonus: bonus ? { kind: bonus.kind, x: m.bonusTile[0], y: m.bonusTile[1], left: bonus.left } : null,
			popups: popups.map((p) => ({ ...p })),
			events
		};
	}

	function frame(): Frame {
		const f = snapshot();
		events = [];
		return f;
	}

	loadLevel();
	events = [];

	return {
		config,
		get maze() { return m; },
		get dots() { return dots; },
		get deaths() { return deaths; },
		get info() { return lv; },
		steer(d: Facing) { want = d; wantAge = 0; },
		update,
		frame,
		peek() { return { ...snapshot(), events: events.slice() }; },
		scene(): Scene { return { maze: m, dots, frame: frame() }; },
		targetOf(id: GhostId) {
			const g = ghosts.find((e) => e.id === id)!;
			return targetFor(g);
		},
		goToLevel(n: number) {
			endPower('cleared');
			level = Math.max(1, Math.floor(n));
			loadLevel();
			setPhase('ready');
			emit({ type: 'level', level });
		}
	};
}

/**
 * Tunnel tiles: on each tunnel row, the open run from each edge that has walls above and below
 * (the tube). Ghosts slow down here.
 */
export function tunnelTiles(m: Maze): Uint8Array {
	const out = new Uint8Array(m.W * m.H);
	const closed = (x: number, y: number) =>
		(y <= 0 || m.tiles[(y - 1) * m.W + x] !== PATH) && (y >= m.H - 1 || m.tiles[(y + 1) * m.W + x] !== PATH);
	for (const y of m.tunnelRows) {
		for (let x = 0; x < m.W && m.tiles[y * m.W + x] === PATH && closed(x, y); x++) out[y * m.W + x] = 1;
		for (let x = m.W - 1; x >= 0 && m.tiles[y * m.W + x] === PATH && closed(x, y); x--) out[y * m.W + x] = 1;
	}
	return out;
}
