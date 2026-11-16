import { describe, expect, it } from 'vitest';
import { STUDY_CONFIG, createGame } from './game';
import { createBot } from './bot';
import type { GameConfig } from '../types';

const STEP = 1 / 120;

function play(config: Partial<GameConfig>, opts: Parameters<typeof createBot>[1], seconds: number) {
	const game = createGame(config);
	const bot = createBot(game, opts);
	const tally = { clear: false, over: false, dies: 0, eats: 0, powers: 0, t: 0, caughtAfterEnd: 0 };
	let lastExpired = -Infinity;
	for (let i = 0; i < seconds / STEP; i++) {
		bot.step();
		game.update(STEP);
		const f = game.frame();
		for (const e of f.events) {
			if (e.type === 'clear') tally.clear = true;
			if (e.type === 'over') tally.over = true;
			if (e.type === 'eat') tally.eats++;
			if (e.type === 'power') tally.powers++;
			if (e.type === 'powerEnd' && e.reason === 'expired') lastExpired = e.t;
			if (e.type === 'die') { tally.dies++; if (e.t - lastExpired < 3) tally.caughtAfterEnd++; }
		}
		tally.t = f.t;
		if (tally.clear || tally.over) break;
	}
	return tally;
}

describe('bot', () => {
	it('with skill 1 usually clears level 1 on normal within three minutes', () => {
		const runs = [1, 2, 3, 4, 5, 6].map((seed) => play({ seed }, { seed, skill: 1 }, 180));
		const cleared = runs.filter((r) => r.clear).length;
		expect(cleared, JSON.stringify(runs)).toBeGreaterThanOrEqual(5);
		expect(runs.reduce((n, r) => n + r.eats, 0)).toBeGreaterThan(0);
	});

	it('plays worse with low skill', () => {
		const good = [1, 2, 3, 4].map((seed) => play({ seed, infiniteLives: true }, { seed, skill: 1 }, 120));
		const poor = [1, 2, 3, 4].map((seed) => play({ seed, infiniteLives: true }, { seed, skill: 0.3 }, 120));
		const dies = (rs: typeof good) => rs.reduce((n, r) => n + r.dies, 0);
		const time = (rs: typeof good) => rs.reduce((n, r) => n + r.t, 0);
		expect(dies(poor) * 100 + time(poor)).toBeGreaterThan(dies(good) * 100 + time(good));
	});

	it('is deterministic and draws one belief error per power-up', () => {
		const a = createGame({ ...STUDY_CONFIG, seed: 3 }), b = createGame({ ...STUDY_CONFIG, seed: 3 });
		const ba = createBot(a, { seed: 4, awarenessNoise: 1.5 }), bb = createBot(b, { seed: 4, awarenessNoise: 1.5 });
		const errors = new Set<number>();
		for (let i = 0; i < 90 / STEP; i++) {
			ba.step(); bb.step();
			a.update(STEP); b.update(STEP);
			if (a.peek().power.left > 0) errors.add(ba.error);
		}
		expect(JSON.stringify(a.frame())).toBe(JSON.stringify(b.frame()));
		expect(errors.size).toBeGreaterThan(1);
	});

	it('a bot that knows the time exactly is rarely caught by ghosts turning back; an overconfident one is caught more', () => {
		const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
		const sum = (opts: Parameters<typeof createBot>[1]) => seeds
			.map((seed) => play({ ...STUDY_CONFIG, seed }, { seed, ...opts }, 150))
			.reduce((a, r) => ({ caught: a.caught + r.caughtAfterEnd, eats: a.eats + r.eats }), { caught: 0, eats: 0 });
		const exact = sum({ awarenessNoise: 0, caution: 0.6 });
		const reckless = sum({ awarenessNoise: 0, caution: -2 });
		expect(exact.eats).toBeGreaterThan(5);
		expect(reckless.caught).toBeGreaterThan(exact.caught);
	});
});
