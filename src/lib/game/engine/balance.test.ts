import { it, vi } from 'vitest';

/**
 * Bot balance table: every maze at level-1 rules, arcade and study, eight seeds of three minutes.
 * Slow (about 25 s), so it only runs on request:  BALANCE=1 npx vitest run src/lib/game/engine/balance.test.ts --silent=false
 * Use it after changing a maze or the level rules; no maze should stand out in deaths per minute.
 */

// Every maze at the same rules: swap the maze under the level table.
const pick = vi.hoisted(() => ({ id: '' }));
vi.mock('./mazes', async (orig) => {
	const real = await orig<typeof import('./mazes')>();
	return { ...real, mazeForLevel: (l: number) => (pick.id ? real.mazeById(pick.id) : real.mazeForLevel(l)) };
});

import { MAZE_DEFS } from './mazes';
import { STUDY_CONFIG, createGame } from './game';
import { createBot } from './bot';

const STEP = 1 / 120;
it.runIf(process.env.BALANCE)('balance table', () => {
	const rows: string[] = [];
	for (const mode of ['arcade', 'study'] as const) for (const d of MAZE_DEFS) {
		pick.id = d.id;
		let dies = 0, mins = 0, clears = 0, eats = 0, powers = 0, dots = 0, caughtAfter = 0;
		for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
			const cfg = mode === 'arcade' ? { seed, infiniteLives: true, fixedLevel: true } : { ...STUDY_CONFIG, seed };
			const game = createGame(cfg);
			const bot = createBot(game, { seed, skill: 1, awarenessNoise: mode === 'study' ? 1 : 0 });
			let lastEnd = -Infinity;
			for (let i = 0; i < 180 / STEP; i++) {
				bot.step(); game.update(STEP);
				for (const e of game.frame().events) {
					if (e.type === 'die') { dies++; if (e.t - lastEnd < 3) caughtAfter++; }
					if (e.type === 'clear') clears++;
					if (e.type === 'eat') eats++;
					if (e.type === 'power') powers++;
					if (e.type === 'dot') dots++;
					if (e.type === 'powerEnd' && e.reason === 'expired') lastEnd = e.t;
				}
			}
			mins += 3;
		}
		rows.push(`${mode.padEnd(6)} ${d.id.padEnd(8)} deaths/min ${(dies / mins).toFixed(2)}  clears ${clears}  dots/min ${(dots / mins).toFixed(0)}  powers ${powers}  ghosts eaten/power ${(eats / Math.max(1, powers)).toFixed(2)}  caught<3s after end ${caughtAfter}`);
	}
	console.log('\n' + rows.join('\n'));
}, 300000);
