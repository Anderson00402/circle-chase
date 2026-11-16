import { describe, expect, it } from 'vitest';
import { BONUS_ITEMS, MIN_POWER_TIME, bonusItem, levelInfo } from './levels';
import { CHAIN_POINTS, EXTRA_LIFE_EVERY } from './game';
import type { Difficulty } from '../types';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

describe('levelInfo', () => {
	it('names the level and its maze', () => {
		const i = levelInfo(2);
		expect(i.label).toBe(`Level 2 · ${i.mazeName}`);
		expect(levelInfo(7).mazeId).toBe(levelInfo(2).mazeId);
	});

	it('ramps speeds: the ghosts close the gap but the player stays a little faster in the open', () => {
		const l1 = levelInfo(1), l2 = levelInfo(2), l5 = levelInfo(5), l21 = levelInfo(21);
		expect(l2.ghostSpeed).toBeGreaterThan(l1.ghostSpeed);
		expect(l5.ghostSpeed).toBeGreaterThan(l2.ghostSpeed);
		expect(l21.ghostSpeed).toBeGreaterThan(l5.ghostSpeed);
		// The gap is widest on level 1 and narrows from there.
		expect(l1.playerSpeed - l1.ghostSpeed).toBeGreaterThan(l5.playerSpeed - l5.ghostSpeed);
		for (let l = 1; l <= 30; l++) {
			const i = levelInfo(l);
			expect(i.playerSpeed).toBeGreaterThan(i.ghostSpeed);
			expect(i.playerPowerSpeed).toBeGreaterThanOrEqual(i.playerSpeed);
			expect(i.ghostScaredSpeed).toBeLessThan(i.ghostSpeed);
			expect(i.ghostTunnelSpeed).toBeLessThan(i.ghostSpeed);
			expect(i.eyesSpeed).toBeGreaterThan(i.playerSpeed);
			expect(i.hurrySpeed2).toBeGreaterThan(i.hurrySpeed);
			expect(i.waves.at(-1)).toBe(Infinity);
		}
	});

	it('calm spells shrink and chases grow, wave by wave and level by level', () => {
		const w1 = levelInfo(1).waves, w8 = levelInfo(8).waves;
		const calm = (w: number[]) => w.filter((_, k) => k % 2 === 0), chase = (w: number[]) => w.filter((_, k) => k % 2 === 1 && Number.isFinite(w[k]));
		for (const w of [w1, w8]) {
			expect(calm(w)).toEqual([...calm(w)].sort((a, b) => b - a));
			expect(chase(w)).toEqual([...chase(w)].sort((a, b) => a - b));
		}
		expect(calm(w8)[0]).toBeLessThan(calm(w1)[0]);
		expect(chase(w8)[0]).toBeGreaterThan(chase(w1)[0]);
	});

	it('power gets shorter with level and difficulty, and is never under 2 s', () => {
		expect(levelInfo(1).powerTime).toBeGreaterThan(levelInfo(5).powerTime);
		expect(levelInfo(1, 'easy').powerTime).toBeGreaterThan(levelInfo(1).powerTime);
		expect(levelInfo(1, 'hard').powerTime).toBeLessThan(levelInfo(1).powerTime);
		expect(levelInfo(1, 'hard').ghostSpeed).toBeGreaterThan(levelInfo(1).ghostSpeed);
		for (const d of DIFFS) for (let l = 1; l < 60; l++) expect(levelInfo(l, d).powerTime).toBeGreaterThanOrEqual(MIN_POWER_TIME);
		expect(MIN_POWER_TIME).toBe(2);
	});

	it('waiting ghosts leave sooner on later levels', () => {
		const sum = (l: number) => levelInfo(l).releaseDots.reduce((a, b) => a + b, 0);
		expect(sum(1)).toBeGreaterThan(sum(2));
		expect(sum(2)).toBeGreaterThan(sum(5));
		expect(levelInfo(1).releaseDots[0]).toBe(0);
	});

	it('one bonus item per level for the first eight, each worth more than the last', () => {
		const pts = [1, 2, 3, 4, 5, 6, 7, 8].map((l) => levelInfo(l).bonus.points);
		expect(pts).toEqual([...pts].sort((a, b) => a - b));
		expect(new Set(pts).size).toBe(8);
		expect(levelInfo(20).bonus).toEqual(levelInfo(8).bonus);
		// One entry per drawing, each drawing once.
		expect(BONUS_ITEMS.map((b) => b.kind).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		expect(bonusItem(7).name).toBe('Rocket');
	});

	it('uses our own numbers, not a copy of the classic tables', () => {
		const i = levelInfo(1);
		expect(i.waves.slice(0, 7)).not.toEqual([7, 20, 7, 20, 5, 20, 5]);
		expect([...CHAIN_POINTS]).not.toEqual([200, 400, 800, 1600]);
		expect(BONUS_ITEMS.map((b) => b.points).slice(0, 3)).not.toEqual([100, 300, 500]);
		expect(EXTRA_LIFE_EVERY).not.toBe(10000);
		expect([i.playerSpeed, i.ghostSpeed].map((s) => Math.round((s / 7) * 100))).not.toEqual([80, 75]);
	});
});
