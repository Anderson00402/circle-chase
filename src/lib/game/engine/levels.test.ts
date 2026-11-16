import { describe, expect, it } from 'vitest';
import { levelInfo } from './levels';

describe('levelInfo', () => {
	it('names the level and its maze', () => {
		const i = levelInfo(2);
		expect(i.label).toBe(`Level 2 · ${i.mazeName}`);
		expect(levelInfo(7).mazeId).toBe(levelInfo(2).mazeId);
	});

	it('ramps speeds the arcade way', () => {
		const l1 = levelInfo(1), l2 = levelInfo(2), l5 = levelInfo(5), l21 = levelInfo(21);
		expect(l1.playerSpeed).toBeGreaterThan(l1.ghostSpeed);
		expect(l2.ghostSpeed).toBeGreaterThan(l1.ghostSpeed);
		expect(l5.ghostSpeed).toBeGreaterThan(l2.ghostSpeed);
		expect(l5.playerSpeed).toBeGreaterThan(l5.ghostSpeed);
		expect(l21.playerSpeed).toBeLessThan(l5.playerSpeed);
		for (const l of [l1, l2, l5, l21]) {
			expect(l.ghostScaredSpeed).toBeLessThan(l.ghostSpeed);
			expect(l.ghostTunnelSpeed).toBeLessThan(l.ghostSpeed);
			expect(l.eyesSpeed).toBeGreaterThan(l.playerSpeed);
			expect(l.waves.at(-1)).toBe(Infinity);
		}
	});

	it('power gets shorter with level and difficulty', () => {
		expect(levelInfo(1).powerTime).toBeGreaterThan(levelInfo(5).powerTime);
		expect(levelInfo(1, 'easy').powerTime).toBeGreaterThan(levelInfo(1).powerTime);
		expect(levelInfo(1, 'hard').powerTime).toBeLessThan(levelInfo(1).powerTime);
		expect(levelInfo(1, 'hard').ghostSpeed).toBeGreaterThan(levelInfo(1).ghostSpeed);
		for (let l = 1; l < 40; l++) expect(levelInfo(l, 'hard').powerTime).toBeGreaterThanOrEqual(1.5);
	});

	it('bonus items grow in value', () => {
		expect(levelInfo(1).bonus.points).toBe(100);
		expect(levelInfo(13).bonus.points).toBeGreaterThan(levelInfo(5).bonus.points);
	});
});
