import { describe, expect, it } from 'vitest';
import type { Cue, Frame, Sfx } from '../types';
import { heartbeat } from './heartbeat';
import { deflatingPlayer } from './deflating-player';
import { countFrom, finalCount } from './final-count';

const STEP = 1 / 120;

/** A frame with only what the sound hooks read. */
function frame(left: number, total: number, serial: number, expired = false): Frame {
	return {
		power: { left, total, serial, startedAt: 0, endedAt: -1, endReason: null, chain: 0 },
		events: expired ? [{ t: 0, type: 'powerEnd', reason: 'expired' }] : []
	} as unknown as Frame;
}

/** Plays one power-up of `total` seconds through a cue's sound hook; returns (seconds left, freq) per tone. */
function play(cue: Cue, total: number) {
	const out: { left: number; freq: number }[] = [];
	let left = 0;
	const sfx = {
		enabled: true,
		tone: (freq: number) => out.push({ left, freq }),
		noise: () => {},
		arp: () => {},
		note: (n: string) => ({ E5: 659.3, A5: 880, E6: 1318.5 })[n] ?? 440
	} as unknown as Sfx;
	let prev = frame(0, 0, 0);
	for (let t = 0; t <= total + 0.5; t += STEP) {
		left = Math.max(0, total - t);
		const f = frame(left, total, 1, left === 0 && prev.power.left > 0);
		cue.sound!(prev, f, sfx);
		prev = f;
	}
	return out;
}

describe('heartbeat sound', () => {
	it('lands its beats counted back from the end, five fast ones in the last 2 s', () => {
		for (const total of [2, 4.3, 6.7, 9]) {
			const lubs = play(heartbeat, total).filter((s) => s.freq === 95).map((s) => s.left);
			// Each beat fires on the first frame at or past its time.
			for (const l of lubs) expect(Math.abs(l / 0.4 - Math.round(l / 0.4)) * 0.4 < STEP || l > 2).toBe(true);
			expect(lubs.filter((l) => l <= 2.0 + STEP).length).toBe(total > 2.05 ? 5 : 4);
			const finals = play(heartbeat, total).filter((s) => s.freq === 110);
			expect(finals).toHaveLength(1);
			expect(finals[0].left).toBe(0);
		}
	});

	it('beats slow (1 s) early on, then faster', () => {
		const lubs = play(heartbeat, 9).filter((s) => s.freq === 95).map((s) => s.left);
		const gaps = lubs.slice(1).map((l, i) => lubs[i] - l);
		expect(gaps[0]).toBeCloseTo(1, 1);
		expect(gaps.at(-1)).toBeCloseTo(0.4, 1);
	});
});

describe('final count', () => {
	it('counts 3-2-1 on long power-ups and less on short ones', () => {
		expect(countFrom(8)).toBe(3);
		expect(countFrom(3.5)).toBe(3);
		expect(countFrom(3.2)).toBe(2);
		expect(countFrom(2)).toBe(1);
	});

	it('ticks exactly as each whole second is crossed', () => {
		const ticks = play(finalCount, 6.3).filter((s) => s.freq < 2000 && s.freq > 600 && s.left > 0);
		const square = ticks.filter((_, i) => i % 2 === 0);
		expect(square.map((s) => Math.round(s.left))).toEqual([3, 2, 1]);
		for (const s of square) expect(Math.abs(s.left - Math.round(s.left))).toBeLessThan(STEP + 1e-9);
	});
});

describe('deflating player', () => {
	it('ticks once per spark that goes out and puffs once at the end', () => {
		const tones = play(deflatingPlayer, 5);
		expect(tones.filter((s) => s.freq >= 1500)).toHaveLength(9);
		expect(tones.filter((s) => s.freq === 560)).toHaveLength(1);
	});
});
