import { describe, expect, it } from 'vitest';
import {
	CHAIN_POINTS, CLEAR_TIME, DEATH_TIME, EXTRA_LIFE_EVERY, POWER_LOCK_AFTER, READY_TIME, STUDY_CONFIG, TURN_MEMORY,
	createGame, tunnelTiles, type EngineGame
} from './game';
import { createBot, type BotOptions } from './bot';
import { levelInfo } from './levels';
import type { GameConfig, GameEvent } from '../types';

const STEP = 1 / 120;

/** Runs a game for `seconds` of updates, collecting every event. Stops early when `until` says so. */
function run(game: EngineGame, seconds: number, pilot?: () => void, until?: (e: GameEvent[]) => boolean) {
	const events: GameEvent[] = [];
	for (let i = 0; i < seconds / STEP; i++) {
		pilot?.();
		game.update(STEP);
		const ev = game.frame().events;
		events.push(...ev);
		if (until && ev.length && until(ev)) break;
	}
	return events;
}

function botGame(config: Partial<GameConfig>, bot: Partial<BotOptions> = {}) {
	const game = createGame(config);
	const b = createBot(game, { seed: config.seed ?? 1, ...bot });
	return { game, bot: b, pilot: () => b.step() };
}

describe('game flow', () => {
	it('is deterministic for a seed', () => {
		const a = botGame({ seed: 7 }, { skill: 0.8 }), b = botGame({ seed: 7 }, { skill: 0.8 });
		run(a.game, 40, a.pilot);
		run(b.game, 40, b.pilot);
		expect(JSON.stringify(a.game.frame())).toBe(JSON.stringify(b.game.frame()));
		const c = botGame({ seed: 8 }, { skill: 0.8 });
		run(c.game, 40, c.pilot);
		expect(JSON.stringify(c.game.frame())).not.toBe(JSON.stringify(a.game.frame()));
	});

	it('goes READY -> playing -> clear -> next level', () => {
		const { game, pilot } = botGame({ seed: 2, infiniteLives: true });
		expect(game.frame().phase).toBe('ready');
		run(game, READY_TIME - 0.1);
		expect(game.frame().phase).toBe('ready');
		run(game, 0.2);
		expect(game.frame().phase).toBe('playing');
		const firstMaze = game.maze.id;
		const events = run(game, 400, pilot, (ev) => ev.some((e) => e.type === 'clear'));
		expect(events.some((e) => e.type === 'clear'), 'bot cleared level 1').toBe(true);
		expect(game.frame().phase).toBe('clear');
		expect(game.frame().power.left).toBe(0);
		const later = run(game, CLEAR_TIME + 0.1);
		expect(later.find((e) => e.type === 'level')).toMatchObject({ level: 2 });
		const f = game.frame();
		expect(f.phase).toBe('ready');
		expect(f.level).toBe(2);
		expect(game.maze.id).not.toBe(firstMaze);
		expect(f.mazeId).toBe(game.maze.id);
		expect(f.dotsLeft).toBe(game.maze.dotTotal);
		expect(game.info.label).toBe(levelInfo(2).label);
		run(game, READY_TIME + 0.1);
		expect(game.frame().phase).toBe('playing');
	});

	it('a player who never steers dies three times and the game is over', () => {
		const game = createGame({ seed: 4 });
		const events = run(game, 600, undefined, (ev) => ev.some((e) => e.type === 'over'));
		expect(events.filter((e) => e.type === 'die')).toHaveLength(3);
		expect(events.at(-1)?.type).toBe('over');
		const f = game.frame();
		expect(f.phase).toBe('over');
		expect(f.lives).toBe(0);
		expect(game.deaths).toBe(3);
		// Nothing moves once it is over.
		run(game, 2);
		expect(game.frame().player).toEqual(f.player);
	});

	it('after a death the board resets but the dots stay eaten', () => {
		const game = createGame({ seed: 4 });
		run(game, 600, undefined, (ev) => ev.some((e) => e.type === 'die'));
		const dotsLeft = game.frame().dotsLeft;
		expect(game.frame().phase).toBe('dying');
		run(game, DEATH_TIME + 0.05);
		const f = game.frame();
		expect(f.phase).toBe('ready');
		expect(f.lives).toBe(2);
		expect(f.dotsLeft).toBe(dotsLeft);
		expect([f.player.x, f.player.y]).toEqual(game.maze.start);
		expect(f.ghosts[0].mode).toBe('active');
		expect(f.ghosts.slice(1).every((g) => g.mode === 'waiting')).toBe(true);
	});

	it('ghosts leave the pen one by one, by dots eaten or after a quiet spell', () => {
		const game = createGame({ seed: 1 });
		run(game, READY_TIME + 0.05);
		// The player runs left along an empty-ish corridor without steering; idle release kicks in.
		const leftAt: Record<string, number> = {};
		for (let i = 0; i < 20 / STEP; i++) {
			game.update(STEP);
			const f = game.frame();
			for (const g of f.ghosts) if (g.mode !== 'waiting' && !(g.id in leftAt)) leftAt[g.id] = f.t;
			if (f.phase !== 'playing') break;
		}
		expect(Object.keys(leftAt)).toEqual(['hunter', 'ambusher', 'guard', 'drifter']);
		expect(leftAt.ambusher).toBeLessThan(leftAt.guard);
		expect(leftAt.guard).toBeLessThan(leftAt.drifter);
	});
});

describe('power-ups', () => {
	it('keeps full bookkeeping: start, end, reason, reverted and eaten ghosts, serial', () => {
		const { game, pilot } = botGame({ seed: 3, infiniteLives: true });
		let start: GameEvent | undefined, end: GameEvent | undefined;
		const eats: GameEvent[] = [];
		let reverted: string[] = [];
		for (let i = 0; i < 300 / STEP && !(start && end?.type === 'powerEnd' && end.reason === 'expired'); i++) {
			pilot();
			game.update(STEP);
			const f = game.frame();
			for (const e of f.events) {
				if (e.type === 'power') { start = e; end = undefined; eats.length = 0; }
				if (e.type === 'eat') eats.push(e);
				if (e.type === 'powerEnd' && start) {
					end = e;
					if (e.reason === 'expired') reverted = f.ghosts.filter((g) => g.revertedAt === e.t).map((g) => g.id);
				}
			}
			if (start && !end) {
				expect(f.power.startedAt).toBe(start.t);
				expect(f.power.left).toBeGreaterThan(0);
				expect(f.power.total).toBe(levelInfo(f.level).powerTime);
			}
		}
		expect(start && end, 'saw a power-up run out').toBeTruthy();
		const f = game.frame();
		expect(f.power.left).toBe(0);
		expect(f.power.endedAt).toBe(end!.t);
		expect(f.power.endReason).toBe('expired');
		expect(f.power.serial).toBeGreaterThanOrEqual(1);
		expect(end!.t - start!.t).toBeGreaterThanOrEqual(levelInfo(f.level).powerTime - 1e-6);
		for (const e of eats) if (e.type === 'eat') {
			expect(f.ghosts.find((g) => g.id === e.ghost)!.eatenAt).toBe(e.t);
			expect(e.left).toBeGreaterThan(0);
		}
		// Every ghost still scared at the end turned back at that moment; eaten ones did not.
		for (const id of reverted) expect(eats.some((e) => e.type === 'eat' && e.ghost === id && e.t > start!.t)).toBe(false);
		expect(reverted.length + eats.length).toBeGreaterThan(0);
	});

	it('game time stands still while the board freezes after eating a ghost', () => {
		const { game, pilot } = botGame({ seed: 3, infiniteLives: true });
		const events = run(game, 300, pilot, (ev) => ev.some((e) => e.type === 'eat'));
		const eat = events.find((e) => e.type === 'eat')!;
		expect(eat).toBeTruthy();
		const t0 = game.frame().t;
		run(game, 0.2);
		expect(game.frame().t).toBe(t0);
		run(game, 0.3);
		expect(game.frame().t).toBeGreaterThan(t0);
	});

	it('nothing in the rules hints at the time left: scared ghosts keep one speed and one way of moving', () => {
		const { game, pilot } = botGame({ seed: 5, infiniteLives: true }, { skill: 0.7 });
		const m = () => game.maze;
		let checked = 0, prev = game.frame();
		for (let i = 0; i < 400 / STEP && checked < 3000; i++) {
			pilot();
			game.update(STEP);
			const f = game.frame();
			const tube = tunnelTiles(m());
			if (f.phase === 'playing' && prev.phase === 'playing' && f.t > prev.t && f.level === prev.level && f.power.left > 0 && f.power.serial === prev.power.serial && !f.events.some((e) => e.type === 'eat' || e.type === 'die')) {
				const speed = game.info.ghostScaredSpeed;
				for (const g of f.ghosts) {
					const p = prev.ghosts.find((e) => e.id === g.id)!;
					if (!g.scared || !p.scared || g.mode !== 'active' || p.mode !== 'active') continue;
					if (tube[Math.round(g.y) * m().W + ((Math.round(g.x) % m().W) + m().W) % m().W] || tube[Math.round(p.y) * m().W + ((Math.round(p.x) % m().W) + m().W) % m().W]) continue;
					let dx = Math.abs(g.x - p.x);
					dx = Math.min(dx, m().W - dx);
					const moved = dx + Math.abs(g.y - p.y);
					if (moved > 0.5) continue; // the reversal at the start of the power-up
					expect(moved).toBeCloseTo(speed * (f.t - prev.t), 5);
					checked++;
				}
			}
			prev = f;
		}
		expect(checked).toBeGreaterThan(500);
	});
});

describe('scoring', () => {
	it('ghosts caught in one power-up score our own chain, and lives come every 7,500 points', () => {
		const { game, pilot } = botGame({ seed: 3, infiniteLives: true }, { skill: 1 });
		const chains = new Map<number, number[]>();
		let extras = 0, serial = 0;
		for (let i = 0; i < 400 / STEP; i++) {
			pilot();
			game.update(STEP);
			const f = game.frame();
			for (const e of f.events) {
				if (e.type === 'power') serial++;
				if (e.type === 'eat') chains.set(serial, [...(chains.get(serial) ?? []), e.points]);
				if (e.type === 'extra') extras++;
			}
		}
		expect(chains.size).toBeGreaterThan(0);
		for (const pts of chains.values()) expect(pts).toEqual(CHAIN_POINTS.slice(0, pts.length));
		const score = game.frame().score;
		expect(score).toBeGreaterThan(EXTRA_LIFE_EVERY);
		expect(extras).toBe(Math.floor(score / EXTRA_LIFE_EVERY));
	});

	it('the bonus event names the item that was eaten', () => {
		const { game, pilot } = botGame({ seed: 2, infiniteLives: true });
		let shown = -1;
		for (let i = 0; i < 300 / STEP; i++) {
			pilot();
			game.update(STEP);
			for (const e of game.frame().events) {
				if (e.type === 'bonusShow') shown = e.kind;
				if (e.type === 'bonus') { expect(e.kind).toBe(shown); expect(e.points).toBe(game.info.bonus.points); return; }
			}
		}
		throw new Error('the bot never ate a bonus item');
	});
});

describe('study mode', () => {
	it('never ends, keeps power lengths in range at every level, grows power dots back', () => {
		const { game, pilot } = botGame({ ...STUDY_CONFIG, seed: 5 }, { skill: 0.6, awarenessNoise: 2 });
		const events = run(game, 300, pilot);
		expect(game.frame().phase).not.toBe('over');
		const powers = events.filter((e) => e.type === 'power');
		expect(powers.length).toBeGreaterThan(4);
		for (const e of powers) if (e.type === 'power') {
			expect(e.total).toBeGreaterThanOrEqual(4);
			expect(e.total).toBeLessThanOrEqual(8);
		}
		expect(new Set(powers.map((e) => (e.type === 'power' ? e.total : 0))).size).toBeGreaterThan(1);
		expect(events.some((e) => e.type === 'powerRespawn')).toBe(true);
		expect(game.frame().lives).toBeGreaterThanOrEqual(3);
		// Deep into the game the range still decides, not the level table.
		game.goToLevel(9);
		const late = run(game, 120, pilot).filter((e) => e.type === 'power');
		expect(late.length).toBeGreaterThan(0);
		for (const e of late) if (e.type === 'power') expect(e.total).toBeGreaterThanOrEqual(4);
	});

	it('deaths are counted but do not end the game', () => {
		const game = createGame({ ...STUDY_CONFIG, seed: 9 });
		run(game, 200);
		expect(game.deaths).toBeGreaterThanOrEqual(3);
		expect(game.frame().phase).not.toBe('over');
	});
});

describe('feel', () => {
	it('the player can start a buffered turn just before the tile centre', () => {
		const game = createGame({ seed: 1 });
		const m = game.maze;
		run(game, READY_TIME + 0.02);
		// Run left from the start until just short of a tile with an opening above it.
		let f = game.frame(), turnX = -1;
		for (let i = 0; i < 400 && turnX < 0; i++) {
			game.update(STEP);
			f = game.frame();
			const next = Math.floor(f.player.x);
			const frac = f.player.x - next;
			if (frac > 0.05 && frac < 0.3 && m.tiles[(f.player.y - 1) * m.W + next] === 0) turnX = next;
		}
		expect(turnX).toBeGreaterThan(0);
		const y0 = f.player.y;
		game.steer(0);
		game.update(STEP);
		f = game.frame();
		expect(f.player.dir).toBe(0);
		expect(f.player.x).toBeGreaterThan(turnX); // still easing onto the new lane
		expect(f.player.y).toBeLessThan(y0); // but already moving up
		run(game, 0.2);
		expect(game.frame().player.x).toBe(turnX);
	});

	/** Level 1 runs the player left from the start along a corridor; the first opening above is `upX`. */
	function runLeft() {
		const game = createGame({ seed: 1, infiniteLives: true });
		const m = game.maze, [sx, sy] = m.start;
		let upX = -1;
		for (let x = sx - 1; x > 0 && upX < 0; x--) if (m.tiles[(sy - 1) * m.W + x] === 0) upX = x;
		run(game, READY_TIME + 0.02);
		return { game, m, sy, upX };
	}
	/** Runs until the player has left row `y` or `seconds` pass. */
	function untilOffRow(game: EngineGame, y: number, seconds: number) {
		for (let i = 0; i < seconds / STEP; i++) {
			game.update(STEP);
			if (Math.abs(game.frame().player.y - y) > 0.5) break;
		}
		return game.frame().player;
	}

	it('a key pressed 3.3 tiles before a junction still turns there', () => {
		const { game, sy, upX } = runLeft();
		expect(upX).toBeGreaterThan(0);
		while (game.frame().player.x > upX + 3.3) game.update(STEP);
		expect(game.frame().player.x).toBeGreaterThan(upX + 3.2);
		game.steer(0);
		const p = untilOffRow(game, sy, 3);
		expect(p.dir).toBe(0);
		expect(Math.round(p.x)).toBe(upX);
	});

	it('a later press replaces the wanted turn', () => {
		const { game, sy, upX } = runLeft();
		game.steer(2); // down: there is no opening below until the far end
		game.update(STEP);
		game.steer(0);
		const p = untilOffRow(game, sy, 3);
		expect(p.dir).toBe(0);
		expect(Math.round(p.x)).toBe(upX);
	});

	it('a wish nothing comes of is dropped after about a second and a half', () => {
		const { game, m, sy } = runLeft();
		expect(TURN_MEMORY).toBeCloseTo(1.5);
		// Down is open only at the far left end of the row; the player gets there after the memory is gone.
		let downX = -1;
		for (let x = m.start[0] - 1; x > 0; x--) if (m.tiles[(sy + 1) * m.W + x] === 0) { downX = x; break; }
		const tiles = m.start[0] - downX;
		expect(tiles / game.info.playerSpeed).toBeGreaterThan(TURN_MEMORY + 0.1);
		game.steer(2);
		run(game, tiles / game.info.playerSpeed + 1);
		const p = game.frame().player;
		expect(p.y).toBe(sy);
		expect(Math.round(p.x)).toBe(downX);
		expect(p.moving).toBe(false);
	});

	it('a swipe held for one moment turns as well as a held key', () => {
		// The page steers once per swipe; the engine must keep it, the same as one key press.
		const a = runLeft(), b = runLeft();
		for (const g of [a.game, b.game]) while (g.frame().player.x > a.upX + 2.5) g.update(STEP);
		a.game.steer(0);
		for (let i = 0; i < 60; i++) { if (i % 4 === 0) b.game.steer(0); b.game.update(STEP); }
		const pa = untilOffRow(a.game, a.sy, 3), pb = untilOffRow(b.game, b.sy, 3);
		expect(Math.round(pa.x)).toBe(a.upX);
		expect(Math.round(pb.x)).toBe(a.upX);
	});

	it('update is cheap: a simulated minute runs in well under a second', () => {
		// Real play: a bot keeps the board busy (ghosts out, power-ups, eats). Only update and frame are timed.
		const { game, pilot } = botGame({ seed: 11, infiniteLives: true }, { skill: 0.9 });
		let spent = 0, steps = 0;
		for (let i = 0; i < 60 / STEP; i++) {
			pilot();
			const t0 = performance.now();
			game.update(STEP);
			if (i % 2 === 0) game.frame();
			spent += performance.now() - t0;
			steps++;
		}
		expect(game.frame().t).toBeGreaterThan(55);
		expect(spent).toBeLessThan(150);
		expect(steps).toBe(7200);
	});

});

describe('fixed level', () => {
	it('study mode keeps the same maze and level settings by default', async () => {
		const { STUDY_CONFIG } = await import('./game');
		expect(STUDY_CONFIG.fixedLevel).toBe(true);
	});
});

describe('power lock', () => {
	it('study mode never refreshes a power-up with a second power dot', async () => {
		const { createGame, STUDY_CONFIG } = await import('./game');
		const { createBot } = await import('./bot');
		for (const seed of [1, 2, 3]) {
			const game = createGame({ ...STUDY_CONFIG, seed });
			const bot = createBot(game, { seed });
			let powers = 0;
			for (let i = 0; i < 120 * 150; i++) {
				bot.step();
				game.update(1 / 120);
				const f = game.frame();
				for (const e of f.events) {
					if (e.type === 'power') powers++;
					if (e.type === 'powerEnd') expect(e.reason).not.toBe('refreshed');
				}
				if (f.power.left > 0) expect(Array.from(game.dots).includes(2)).toBe(false);
			}
			expect(powers).toBeGreaterThan(3);
		}
	});

	it('power dots stay off the board until 3 s after a power-up ended', () => {
		let respawns = 0;
		for (const seed of [1, 2, 3, 4]) {
			const game = createGame({ ...STUDY_CONFIG, seed });
			const bot = createBot(game, { seed });
			let endedAt = -Infinity;
			for (let i = 0; i < 150 / STEP; i++) {
				bot.step();
				game.update(STEP);
				const f = game.frame();
				for (const e of f.events) {
					if (e.type === 'powerEnd') endedAt = e.t;
					if (e.type === 'power') expect(e.t - endedAt).toBeGreaterThanOrEqual(POWER_LOCK_AFTER - 1e-9);
					if (e.type === 'powerRespawn') { respawns++; expect(e.t - endedAt).toBeGreaterThanOrEqual(POWER_LOCK_AFTER - 1e-9); }
				}
				if (f.power.left <= 0 && f.t - endedAt < POWER_LOCK_AFTER) expect(Array.from(game.dots).includes(2)).toBe(false);
			}
		}
		expect(respawns).toBeGreaterThan(4);
	});
});
