/**
 * Test helpers: a hand-driven board (`Sim`) for exact tracker scenarios, and a scripted pilot that
 * plays the real engine. Used by the telemetry tests only.
 */
import { createGame } from '../game/engine/game';
import { mazeForLevel } from '../game/engine/mazes';
import { pathDistances } from '../game/engine/paths';
import {
	DIRS, GHOST_IDS, PATH,
	type Facing, type Frame, type Game, type GameConfig, type GameEvent, type GhostId, type GhostMode, type Maze,
	type Phase, type PowerEndReason, type PowerView, type Scene
} from '../game/types';

export interface SimGhost { id: GhostId; x: number; y: number; mode: GhostMode; scared: boolean; revertedAt: number; eatenAt: number }

/** A board moved by hand. `mt` is time the board has been moving. */
export class Sim {
	maze: Maze = mazeForLevel(1);
	dots = this.maze.dotsInit.slice();
	t = 0;
	mt = 0;
	phase: Phase = 'playing';
	freeze = 0;
	power: PowerView = { left: 0, total: 0, startedAt: -1, endedAt: -1, endReason: null, chain: 0, serial: 0 };
	player = { x: 8, y: 4 };
	ghosts: SimGhost[] = GHOST_IDS.map((id, i) => ({ id, x: 8 + i, y: 10, mode: 'waiting', scared: false, revertedAt: -1, eatenAt: -1 }));
	events: GameEvent[] = [];

	ghost(i: number, x: number, y: number) {
		Object.assign(this.ghosts[i], { x, y, mode: 'active' as GhostMode });
	}
	startPower(total: number) {
		if (this.power.left > 0) this.endPower('refreshed');
		this.power = { ...this.power, left: total, total, startedAt: this.t, endReason: null, chain: 0, serial: this.power.serial + 1 };
		for (const g of this.ghosts) if (g.mode === 'active') g.scared = true;
		this.events.push({ t: this.t, type: 'power', x: 1, y: 1, total });
	}
	endPower(reason: PowerEndReason) {
		if (this.power.left <= 0) return;
		this.power = { ...this.power, left: 0, endedAt: this.t, endReason: reason };
		for (const g of this.ghosts) { if (g.scared && reason === 'expired') g.revertedAt = this.t; g.scared = false; }
		this.events.push({ t: this.t, type: 'powerEnd', reason });
	}
	eat(i: number) {
		const g = this.ghosts[i];
		g.scared = false; g.mode = 'returning'; g.eatenAt = this.t;
		this.power.chain++;
		this.events.push({ t: this.t, type: 'eat', ghost: g.id, points: 200, x: g.x, y: g.y, left: this.power.left });
		this.freeze = 0.35;
	}
	die(i: number) {
		this.events.push({ t: this.t, type: 'die', by: this.ghosts[i].id });
		this.endPower('died');
		this.phase = 'dying';
	}
	frame(): Frame {
		const f: Frame = {
			t: this.t, phase: this.phase, phaseTime: 0, level: 1, mazeId: this.maze.id, score: 0, lives: 3, dotsLeft: 100,
			player: { x: this.player.x, y: this.player.y, dir: 3, face: 3, moving: true },
			ghosts: this.ghosts.map((g) => ({ ...g, dir: 1 as const })),
			power: { ...this.power }, bonus: null, popups: [], events: this.events
		};
		this.events = [];
		return f;
	}
	scene(): Scene { return { maze: this.maze, dots: this.dots, frame: this.frame() }; }
	/**
	 * Advance one frame. Like the engine, game time stands still during the freeze after an eat;
	 * `move` runs only while the board moves.
	 */
	step(dt: number, move?: (s: Sim, dt: number) => void) {
		if (this.phase === 'playing' && this.freeze > 0) { this.freeze -= dt; return; }
		this.t += dt;
		if (this.phase !== 'playing') return;
		this.mt += dt;
		if (this.power.left > 0) {
			this.power.left -= dt;
			if (this.power.left <= 1e-9) { this.power.left = 1e-9; this.endPower('expired'); }
		}
		move?.(this, dt);
	}
}

// ---------- scripted pilot on the real engine ----------

export type Policy = 'chase' | 'ignore' | { retreatAt: number };

/** Picks a direction for the player from the scene, like a simple human. */
export function pilotDir(scene: Scene, policy: Policy): Facing | null {
	const { maze: m, dots, frame: f } = scene;
	const px = ((Math.round(f.player.x) % m.W) + m.W) % m.W, py = Math.round(f.player.y);
	const pi = py * m.W + px;
	const scared = f.ghosts.filter((g) => g.scared && g.mode === 'active');
	const chase = f.power.left > 0 && scared.length > 0 && policy !== 'ignore' &&
		(policy === 'chase' || f.power.left > policy.retreatAt);
	const flee = f.power.left > 0 && scared.length > 0 && typeof policy === 'object' && f.power.left <= policy.retreatAt;
	const here = pathDistances(m, [px, py]);
	const tileOf = (x: number, y: number) => (Math.round(y) * m.W + ((Math.round(x) % m.W) + m.W) % m.W);
	let goal = -1;
	if (chase) {
		let best = Infinity;
		for (const g of scared) { const i = tileOf(g.x, g.y); if (here[i] >= 0 && here[i] < best) { best = here[i]; goal = i; } }
	} else if (flee) {
		// Head for the reachable tile farthest from the nearest scared ghost.
		const g = scared.reduce((a, b) => (here[tileOf(a.x, a.y)] <= here[tileOf(b.x, b.y)] ? a : b));
		const from = pathDistances(m, [Math.round(g.x), Math.round(g.y)]);
		let best = -1;
		for (const d of DIRS) {
			const j = ((py + d.y) * m.W) + ((px + d.x + m.W) % m.W);
			if (m.tiles[j] === PATH && from[j] > best) { best = from[j]; goal = j; }
		}
		if (goal >= 0) return dirTo(m, pi, goal);
	} else {
		let best = Infinity;
		for (let i = 0; i < dots.length; i++) {
			if (!dots[i] || here[i] < 0) continue;
			const cost = here[i] - (dots[i] === 2 && f.power.left <= 0 ? 6 : 0);
			if (cost < best) { best = cost; goal = i; }
		}
	}
	if (goal < 0 || goal === pi) return null;
	const toGoal = pathDistances(m, [goal % m.W, (goal / m.W) | 0]);
	let bestD = Infinity, dir: Facing | null = null;
	for (let d = 0; d < 4; d++) {
		const j = ((py + DIRS[d].y) * m.W) + ((px + DIRS[d].x + m.W) % m.W);
		if (toGoal[j] >= 0 && toGoal[j] < bestD) { bestD = toGoal[j]; dir = d as Facing; }
	}
	return dir;
}

function dirTo(m: Maze, from: number, to: number): Facing | null {
	const fx = from % m.W, fy = (from / m.W) | 0, tx = to % m.W, ty = (to / m.W) | 0;
	for (let d = 0; d < 4; d++) if (((fx + DIRS[d].x + m.W) % m.W) === tx && fy + DIRS[d].y === ty) return d as Facing;
	return null;
}

/** Plays a real game for `seconds`, calling `each(scene, game)` at 60 Hz. */
export function playScripted(config: Partial<GameConfig>, seconds: number, policy: Policy, each: (scene: Scene, game: Game) => void) {
	const game = createGame(config);
	const STEP = 1 / 120;
	for (let i = 0; i < seconds * 120; i++) {
		game.update(STEP);
		if (i % 2 === 1) {
			const scene = game.scene();
			each(scene, game);
			const d = pilotDir(scene, policy);
			if (d !== null) game.steer(d);
		}
	}
	return game;
}
