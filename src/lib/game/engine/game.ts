import {
	DIRS, DOOR, PATH, PEN, WALL, GHOST_IDS,
	type Difficulty, type Dir, type Facing, type Frame, type Game, type GameConfig, type GameEvent,
	type GhostId, type GhostMode, type Maze, type Popup, type PowerEndReason, type Scene
} from '../types';
import { flood, mazeForLevel } from './mazes';

/** Game rules. No page access here, so the same code runs in tests, bots and the browser. */

export const PLAYER_SPEED = 5.7; // tiles per second
const TURN_MEMORY = 0.5; // seconds an early key press is kept
export const READY_TIME = 1.8, DEATH_TIME = 1.6, CLEAR_TIME = 2.2;
const EAT_FREEZE = 0.35; // the board holds still for a moment when a ghost is eaten
const HIT_RADIUS2 = 0.36; // squared distance in tiles at which player and ghost touch
const BONUS_AT = [0.3, 0.65]; // share of dots eaten at which the bonus item appears
const BONUS_TIME = 9;
const BONUS_POINTS = [100, 300, 500, 700, 1000, 2000, 3000, 5000];

/** Scatter corners, as fractions of the maze so they work at any size. */
const CORNERS: Record<GhostId, [number, number]> = {
	hunter: [1, 0], ambusher: [0, 0], guard: [0, 1], drifter: [1, 1]
};

export interface DifficultyDef {
	label: string;
	lives: number;
	/** Ghost speed on level 1 as a share of the player's; rises by enemyStep per level up to enemyMax. */
	enemy: number;
	enemyStep: number;
	enemyMax: number;
	/** Power-up seconds on level 1; drops by 0.5 per level, never below 2. */
	fright: number;
	/** Seconds after the round starts at which each ghost leaves the pen. */
	release: number[];
	/** Alternating scatter/chase lengths in seconds, starting with scatter. */
	waves: number[];
}
export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
	easy: { label: 'Easy', lives: 5, enemy: 0.6, enemyStep: 0.03, enemyMax: 0.85, fright: 9, release: [0, 3, 7, 11], waves: [9, 15, 9, 15, 7, Infinity] },
	normal: { label: 'Normal', lives: 3, enemy: 0.7, enemyStep: 0.04, enemyMax: 0.95, fright: 6, release: [0, 2, 5, 8], waves: [7, 20, 7, 20, 5, Infinity] },
	hard: { label: 'Hard', lives: 3, enemy: 0.8, enemyStep: 0.04, enemyMax: 1, fright: 3.5, release: [0, 1, 3, 5], waves: [5, 25, 4, Infinity] }
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

interface Mover { x: number; y: number; t: number; dir: Dir }
interface Player extends Mover { face: Facing }
interface Ghost extends Mover {
	id: GhostId;
	mode: GhostMode;
	releaseAt: number;
	scared: boolean;
	flip: boolean;
	drift: [number, number];
	driftAt: number;
	revertedAt: number;
	eatenAt: number;
}

/** A game event without its time stamp. */
type EventBody = GameEvent extends infer E ? (E extends unknown ? Omit<E, 't'> : never) : never;

const rev = (d: Dir): Dir => (d < 0 ? -1 : (((d + 2) % 4) as Dir));

export function createGame(partial: Partial<GameConfig> = {}): Game {
	const config: GameConfig = { ...DEFAULT_CONFIG, ...partial };
	const diff = DIFFICULTY[config.difficulty] ?? DIFFICULTY.normal;
	const rng = makeRng(config.seed);

	let m: Maze, dots: Uint8Array, dotsLeft = 0;
	let distExit: Int16Array, distHome: Int16Array;
	let level = config.startLevel, score = 0, lives = diff.lives, deaths = 0, extraGiven = false;
	let phase: Frame['phase'] = 'ready', phaseTime = 0, time = 0;
	let player: Player, ghosts: Ghost[] = [];
	let want: Dir = -1, wantAge = 0;
	let fright = 0, frightTotal = 0, chain = 0, powerSerial = 0;
	let powerStartedAt = -1, powerEndedAt = -1, powerEndReason: PowerEndReason | null = null;
	let hitStop = 0, lifeTime = 0, modeIndex = 0, modeTime = 0;
	let popups: Popup[] = [], events: GameEvent[] = [];
	let respawns: { i: number; at: number }[] = [];
	let bonus: { kind: number; left: number } | null = null, bonusShown = 0;

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
		dots = m.dotsInit.slice();
		dotsLeft = m.dotTotal;
		distExit = flood(m, m.exit);
		distHome = flood(m, m.home);
		respawns = [];
		bonus = null;
		bonusShown = 0;
		resetActors();
	}

	function resetActors() {
		player = { x: m.start[0], y: m.start[1], dir: 1, face: 1, t: 0 };
		ghosts = GHOST_IDS.map((id, i) => {
			const [x, y] = i === 0 ? m.exit : m.penSlots[(i - 1) % m.penSlots.length];
			return {
				id, x, y, t: 0, dir: i === 0 ? 1 : 0, mode: i === 0 ? 'active' : 'waiting',
				releaseAt: diff.release[i], scared: false, flip: false, drift: [0, 0], driftAt: -1,
				revertedAt: -1, eatenAt: -1
			} as Ghost;
		});
		endPower('died');
		want = -1; wantAge = 0; chain = 0; hitStop = 0; lifeTime = 0; modeIndex = 0; modeTime = 0;
	}

	function addScore(n: number) {
		score += n;
		if (!extraGiven && score >= 10000) { extraGiven = true; lives++; emit({ type: 'extra' }); }
	}

	// ---- power-up ----
	function startPower() {
		if (fright > 0) endPower('refreshed');
		const range = config.frightRange;
		frightTotal = range
			? range[0] + rng() * (range[1] - range[0])
			: Math.max(2, diff.fright - (level - 1) * 0.5);
		fright = frightTotal;
		chain = 0;
		powerSerial++;
		powerStartedAt = time;
		powerEndReason = null;
		for (const e of ghosts) if (e.mode === 'active') { e.scared = true; e.flip = true; }
	}

	function endPower(reason: PowerEndReason) {
		if (fright <= 0) return;
		fright = 0;
		powerEndedAt = time;
		powerEndReason = reason;
		for (const e of ghosts) {
			if (e.scared && reason === 'expired') e.revertedAt = time;
			e.scared = false;
		}
		emit({ type: 'powerEnd', reason });
	}

	// ---- main loop ----
	function update(dt: number) {
		time += dt;
		phaseTime += dt;
		for (const p of popups) p.age += dt;
		if (popups.length) popups = popups.filter((p) => p.age < 1);
		if (phase === 'ready') { if (phaseTime >= READY_TIME) setPhase('playing'); return; }
		if (phase === 'dying') {
			if (phaseTime < DEATH_TIME) return;
			if (lives <= 0) { setPhase('over'); emit({ type: 'over' }); }
			else { resetActors(); setPhase('ready'); }
			return;
		}
		if (phase === 'clear') {
			if (phaseTime >= CLEAR_TIME) { level++; loadLevel(); setPhase('ready'); emit({ type: 'level', level }); }
			return;
		}
		if (phase !== 'playing') return;
		if (hitStop > 0) { hitStop -= dt; return; }
		step(dt);
	}

	function step(dt: number) {
		lifeTime += dt;
		if (want >= 0 && (wantAge += dt) > TURN_MEMORY) want = -1;
		if (fright > 0) {
			fright -= dt;
			if (fright <= 0) { fright = 1e-9; endPower('expired'); }
		} else if (modeIndex < diff.waves.length - 1) {
			modeTime += dt;
			if (modeTime >= diff.waves[modeIndex]) {
				modeIndex++;
				modeTime = 0;
				for (const e of ghosts) if (e.mode === 'active') e.flip = true;
				emit({ type: 'mode', mode: wave() });
			}
		}
		for (const e of ghosts) if (e.mode === 'waiting' && lifeTime >= e.releaseAt) e.mode = 'leaving';
		tickPickups(dt);

		movePlayer(dt);
		if (phase !== 'playing') return;
		for (const e of ghosts) moveGhost(e, dt);
		checkHits();
	}

	function tickPickups(dt: number) {
		if (bonus && (bonus.left -= dt) <= 0) bonus = null;
		if (!respawns.length) return;
		const [px, py] = pos(player);
		respawns = respawns.filter((r) => {
			if (time < r.at) return true;
			const x = r.i % m.W, y = (r.i / m.W) | 0;
			if (Math.abs(px - x) + Math.abs(py - y) < 3) return true; // not under the player's nose
			dots[r.i] = 2;
			dotsLeft++;
			emit({ type: 'powerRespawn', x, y });
			return false;
		});
	}

	// ---- player ----
	const playerCan = (x: number, y: number, d: Dir) => d >= 0 && tileAt(x + DIRS[d].x, y + DIRS[d].y) === PATH;

	function movePlayer(dt: number) {
		const p = player;
		if (want >= 0 && p.dir >= 0 && want === rev(p.dir) && p.t > 0) {
			const d = DIRS[p.dir];
			p.x = wrapX(p.x + d.x); p.y += d.y; p.t = 1 - p.t;
			p.dir = want; p.face = want as Facing; want = -1;
		}
		let dist = PLAYER_SPEED * dt;
		for (let n = 0; dist > 1e-9 && n < 8; n++) {
			if (p.t === 0) {
				if (want >= 0 && playerCan(p.x, p.y, want)) { p.dir = want; want = -1; }
				else if (p.dir < 0 || !playerCan(p.x, p.y, p.dir)) { p.dir = -1; break; }
				p.face = p.dir as Facing;
			}
			const s = Math.min(dist, 1 - p.t);
			p.t += s; dist -= s;
			if (p.t >= 1 - 1e-9) { const d = DIRS[p.dir]; p.x = wrapX(p.x + d.x); p.y += d.y; p.t = 0; }
		}
		// A pickup is eaten once the player is more than halfway onto its tile.
		const [px, py] = pos(p);
		eatAt(wrapX(Math.round(px)), Math.round(py));
	}

	function eatAt(x: number, y: number) {
		const i = y * m.W + x;
		if (bonus && x === m.bonusTile[0] && y === m.bonusTile[1]) {
			const points = BONUS_POINTS[Math.min(bonus.kind, BONUS_POINTS.length - 1)];
			addScore(points);
			popups.push({ x, y, text: '+' + points, age: 0 });
			emit({ type: 'bonus', points, x, y });
			bonus = null;
		}
		const d = dots[i];
		if (!d) return;
		dots[i] = 0;
		dotsLeft--;
		if (d === 2) {
			addScore(50);
			startPower();
			emit({ type: 'power', x, y, total: frightTotal });
			if (config.powerRespawn > 0) respawns.push({ i, at: time + config.powerRespawn });
		} else {
			addScore(10);
			emit({ type: 'dot', x, y });
			const eaten = (m.dotTotal - dotsLeft) / m.dotTotal;
			if (bonusShown < BONUS_AT.length && eaten >= BONUS_AT[bonusShown]) {
				bonusShown++;
				bonus = { kind: level - 1, left: BONUS_TIME };
				emit({ type: 'bonusShow', x: m.bonusTile[0], y: m.bonusTile[1], kind: bonus.kind });
			}
		}
		// The maze is clear when every small dot is gone. Power dots count too, unless they grow back.
		if (smallLeft() === 0 && (config.powerRespawn > 0 || dotsLeft === 0)) {
			endPower('cleared');
			setPhase('clear');
			emit({ type: 'clear' });
		}
	}

	function smallLeft() {
		let power = 0;
		for (let i = 0; i < dots.length; i++) if (dots[i] === 2) power++;
		return dotsLeft - power;
	}

	// ---- ghosts ----
	const ghostPace = () => Math.min(diff.enemyMax, diff.enemy + (level - 1) * diff.enemyStep);

	function ghostSpeed(e: Ghost) {
		if (e.mode === 'returning') return PLAYER_SPEED * 1.9;
		const base = PLAYER_SPEED * ghostPace();
		if (e.mode === 'leaving') return base * 0.55;
		if (e.scared) return PLAYER_SPEED * 0.55;
		if (m.tunnelRows.includes(e.y) && (e.x <= 1 || e.x >= m.W - 2)) return base * 0.6;
		return base;
	}

	function ghostCan(e: Ghost, d: number) {
		const t = tileAt(e.x + DIRS[d].x, e.y + DIRS[d].y);
		if (t === WALL) return false;
		if (t === DOOR || t === PEN) return e.mode === 'leaving' || e.mode === 'returning';
		return true;
	}

	function targetFor(e: Ghost): [number, number] {
		const p = player, d = DIRS[p.face];
		const c = CORNERS[e.id];
		const corner: [number, number] = [c[0] ? m.W - 2 : 1, c[1] ? m.H - 2 : 1];
		if (wave() === 'scatter') return corner;
		switch (e.id) {
			case 'ambusher': return [p.x + d.x * 3, p.y + d.y * 3];
			case 'guard': return p.y >= m.home[1] ? [p.x, p.y] : corner;
			case 'drifter':
				if (time >= e.driftAt) {
					e.drift = [Math.round(rng() * 10 - 5), Math.round(rng() * 10 - 5)];
					e.driftAt = time + 2;
				}
				return [p.x + e.drift[0], p.y + e.drift[1]];
			default: return [p.x, p.y];
		}
	}

	function chooseDir(e: Ghost): Dir {
		const open: number[] = [];
		for (let d = 0; d < 4; d++) if (ghostCan(e, d)) open.push(d);
		if (!open.length) return -1;
		if (e.mode === 'leaving' || e.mode === 'returning') {
			const dist = e.mode === 'leaving' ? distExit : distHome;
			let best = open[0], bestD = Infinity;
			for (const d of open) {
				const n = dist[(e.y + DIRS[d].y) * m.W + wrapX(e.x + DIRS[d].x)];
				if (n >= 0 && n < bestD) { bestD = n; best = d; }
			}
			return best as Dir;
		}
		let pool = open.filter((d) => d !== rev(e.dir));
		if (!pool.length) pool = open;
		if (e.scared) return pool[Math.floor(rng() * pool.length)] as Dir;
		const [tx, ty] = targetFor(e);
		let best = pool[0], bestD = Infinity;
		for (const d of pool) {
			const dd = (e.x + DIRS[d].x - tx) ** 2 + (e.y + DIRS[d].y - ty) ** 2;
			if (dd < bestD) { bestD = dd; best = d; }
		}
		return best as Dir;
	}

	function flip(e: Ghost) {
		if (e.dir < 0) return;
		if (e.t > 0) { const d = DIRS[e.dir]; e.x = wrapX(e.x + d.x); e.y += d.y; e.t = 1 - e.t; }
		e.dir = rev(e.dir);
	}

	function arrive(e: Ghost) {
		if (e.mode === 'leaving' && e.x === m.exit[0] && e.y === m.exit[1]) { e.mode = 'active'; e.scared = false; }
		else if (e.mode === 'returning' && e.x === m.home[0] && e.y === m.home[1]) e.mode = 'leaving';
	}

	function moveGhost(e: Ghost, dt: number) {
		if (e.mode === 'waiting') return;
		if (e.flip) { e.flip = false; flip(e); }
		let dist = ghostSpeed(e) * dt;
		for (let n = 0; dist > 1e-9 && n < 8; n++) {
			if (e.t === 0) {
				arrive(e);
				e.dir = chooseDir(e);
				if (e.dir < 0) return;
			}
			const s = Math.min(dist, 1 - e.t);
			e.t += s; dist -= s;
			if (e.t >= 1 - 1e-9) { const d = DIRS[e.dir]; e.x = wrapX(e.x + d.x); e.y += d.y; e.t = 0; }
		}
	}

	function checkHits() {
		const [px, py] = pos(player);
		for (const e of ghosts) {
			if (e.mode === 'waiting' || e.mode === 'returning') continue;
			const [ex, ey] = pos(e);
			let dx = Math.abs(px - ex);
			dx = Math.min(dx, m.W - dx);
			const dy = py - ey;
			if (dx * dx + dy * dy > HIT_RADIUS2) continue;
			if (e.scared) {
				chain = Math.min(chain + 1, 4);
				const points = 100 * 2 ** chain;
				addScore(points);
				e.scared = false;
				e.mode = 'returning';
				e.eatenAt = time;
				hitStop = EAT_FREEZE;
				popups.push({ x: ex, y: ey, text: '+' + points, age: 0 });
				emit({ type: 'eat', ghost: e.id, points, x: ex, y: ey, left: fright });
				continue;
			}
			deaths++;
			if (!config.infiniteLives) lives--;
			emit({ type: 'die', by: e.id });
			endPower('died');
			setPhase('dying');
			return;
		}
	}

	function frame(): Frame {
		const [px, py] = pos(player);
		const f: Frame = {
			t: time, phase, phaseTime, level, mazeId: m.id, score, lives, dotsLeft,
			player: { x: px, y: py, dir: player.dir, face: player.face, moving: player.dir >= 0 },
			ghosts: ghosts.map((e) => {
				const [x, y] = pos(e);
				return { id: e.id, x, y, dir: e.dir, mode: e.mode, scared: e.scared, revertedAt: e.revertedAt, eatenAt: e.eatenAt };
			}),
			power: {
				left: fright, total: frightTotal, startedAt: powerStartedAt, endedAt: powerEndedAt,
				endReason: powerEndReason, chain, serial: powerSerial
			},
			bonus: bonus ? { kind: bonus.kind, x: m.bonusTile[0], y: m.bonusTile[1], left: bonus.left } : null,
			popups: popups.map((p) => ({ ...p })),
			events
		};
		events = [];
		return f;
	}

	loadLevel();
	events = [];
	powerEndedAt = -1;
	powerEndReason = null;

	return {
		config,
		get maze() { return m; },
		get dots() { return dots; },
		get deaths() { return deaths; },
		steer(d: Facing) { want = d; wantAge = 0; },
		update,
		frame,
		scene(): Scene { return { maze: m, dots, frame: frame() }; },
		targetOf(id: GhostId) { return targetFor(ghosts.find((e) => e.id === id)!); }
	};
}
