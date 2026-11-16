import { describe, expect, it } from 'vitest';
import { createGame, STUDY_CONFIG } from './game';
import { MAZE_DEFS, buildMaze, flood } from './mazes';
import { PATH } from '../types';

const STEP = 1 / 120;
function run(game: ReturnType<typeof createGame>, seconds: number, pilot?: (g: typeof game) => void) {
	const events = [];
	for (let i = 0; i < seconds / STEP; i++) {
		pilot?.(game);
		game.update(STEP);
		if (i % 2 === 0) events.push(...game.frame().events);
	}
	return events;
}

describe('mazes', () => {
	for (const def of MAZE_DEFS) {
		it(`${def.id}: every dot is reachable from the start`, () => {
			const m = buildMaze(def);
			const dist = flood(m, m.start, false);
			for (let i = 0; i < m.dotsInit.length; i++) if (m.dotsInit[i]) expect(dist[i], `dot at ${i % m.W},${(i / m.W) | 0}`).toBeGreaterThan(0);
			expect(m.tiles[m.start[1] * m.W + m.start[0]]).toBe(PATH);
			expect(m.dotTotal).toBeGreaterThan(50);
		});
	}
});

describe('game', () => {
	it('is deterministic for a seed', () => {
		const a = createGame({ seed: 7 }), b = createGame({ seed: 7 });
		run(a, 20); run(b, 20);
		expect(JSON.stringify(a.frame())).toBe(JSON.stringify(b.frame()));
	});

	it('starts playing after READY and the player moves', () => {
		const g = createGame({ seed: 3 });
		run(g, 2.5);
		const f = g.frame();
		expect(f.phase).toBe('playing');
		expect(f.player.x).not.toBe(g.maze.start[0]);
	});

	it('study mode never ends and reports power-ups', () => {
		const g = createGame({ ...STUDY_CONFIG, seed: 5 });
		let k = 0;
		const events = run(g, 120, (game) => { if (k++ % 40 === 0) game.steer((Math.floor(k / 40) % 4) as 0); });
		expect(g.frame().phase).not.toBe('over');
		const starts = events.filter((e) => e.type === 'power');
		for (const e of starts) if (e.type === 'power') { expect(e.total).toBeGreaterThanOrEqual(4); expect(e.total).toBeLessThanOrEqual(8); }
	});
});
