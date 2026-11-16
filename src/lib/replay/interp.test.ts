import { describe, expect, it } from 'vitest';
import { mazeById } from '../game/engine/mazes';
import type { Frame, GhostView, Scene } from '../game/types';
import { indexAt, movePos, sceneAt, stepTime } from './interp';

const maze = mazeById('plaza');
const ghost = (o: Partial<GhostView> = {}): GhostView => ({
	id: 'hunter', x: 5, y: 5, dir: 3, mode: 'active', scared: true, revertedAt: -1, eatenAt: -1, ...o
});
function scene(t: number, o: Partial<Frame> = {}, g: Partial<GhostView> = {}): Scene {
	const frame: Frame = {
		t, phase: 'playing', phaseTime: t, level: 1, mazeId: maze.id, score: 0, lives: 3, dotsLeft: 100,
		player: { x: 1, y: 1, dir: 3, face: 3, moving: true },
		ghosts: [ghost(g)],
		power: { left: 2, total: 5, startedAt: 0, endedAt: -1, endReason: null, chain: 0, serial: 1 },
		bonus: null, popups: [], events: [], ...o
	};
	return { maze, dots: maze.dotsInit, frame };
}

describe('replay interpolation', () => {
	it('finds the sample before a time', () => {
		const s = [scene(0), scene(0.05), scene(0.1)];
		expect(indexAt(s, -1)).toBe(0);
		expect(indexAt(s, 0.07)).toBe(1);
		expect(indexAt(s, 9)).toBe(2);
		expect(stepTime(s, 0.05, 1)).toBeCloseTo(0.1);
		expect(stepTime(s, 0.07, -1)).toBeCloseTo(0.05);
		expect(stepTime(s, 0.05, -1)).toBeCloseTo(0);
	});

	it('moves straight between samples and keeps game time continuous', () => {
		const a = scene(1, { player: { x: 1, y: 1, dir: 3, face: 3, moving: true }, power: { left: 2, total: 5, startedAt: 0, endedAt: -1, endReason: null, chain: 0, serial: 1 } });
		const b = scene(1.05, { player: { x: 1.4, y: 1, dir: 3, face: 3, moving: true }, power: { left: 1.95, total: 5, startedAt: 0, endedAt: -1, endReason: null, chain: 0, serial: 1 } });
		const m = sceneAt([a, b], 1.025).frame;
		expect(m.t).toBeCloseTo(1.025);
		expect(m.player.x).toBeCloseTo(1.2);
		expect(m.power.left).toBeCloseTo(1.975);
	});

	it('takes the short way through a tunnel', () => {
		const W = maze.W;
		const p = movePos(W - 0.8, 10, 0.2, 10, 0.5, W)!;
		// From W-0.8 to 0.2 is one tile to the right through the wrap, not W tiles to the left.
		expect(Math.abs(p[0] - (W - 0.3)) < 1e-9 || Math.abs(p[0] - (-0.3)) < 1e-9).toBe(true);
	});

	it('goes through the corner when turning', () => {
		// (2.8, 3) heading right, turns at (3, 3), reaches (3, 3.2): the midpoint is the corner.
		const p = movePos(2.8, 3, 3, 3.2, 0.5, 28)!;
		expect(p[0]).toBeCloseTo(3);
		expect(p[1]).toBeCloseTo(3);
	});

	it('snaps on a jump (respawn)', () => {
		expect(movePos(1, 1, 14, 20, 0.5, 28)).toBeNull();
	});

	it('switches scared ghosts exactly when the power ends', () => {
		const a = scene(5.0, { power: { left: 0.02, total: 5, startedAt: 0, endedAt: -1, endReason: null, chain: 0, serial: 1 } });
		const b = scene(5.05, { power: { left: 0, total: 5, startedAt: 0, endedAt: 5.02, endReason: 'expired', chain: 0, serial: 1 } }, { scared: false, revertedAt: 5.02 });
		const before = sceneAt([a, b], 5.015).frame;
		expect(before.ghosts[0].scared).toBe(true);
		expect(before.power.left).toBeCloseTo(0.005);
		const after = sceneAt([a, b], 5.021).frame;
		expect(after.ghosts[0].scared).toBe(false);
		expect(after.power.endedAt).toBe(5.02);
		expect(after.power.left).toBe(0);
	});

	it('is a pure function of time (scrubbing back gives the same scene)', () => {
		const s = [scene(0), scene(0.05, { player: { x: 1.4, y: 1, dir: 3, face: 3, moving: true } }), scene(0.1, { player: { x: 1.8, y: 1, dir: 3, face: 3, moving: true } })];
		const one = JSON.stringify(sceneAt(s, 0.073).frame);
		sceneAt(s, 0.02);
		expect(JSON.stringify(sceneAt(s, 0.073).frame)).toBe(one);
	});
});
