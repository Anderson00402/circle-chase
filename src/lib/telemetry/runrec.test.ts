import { describe, expect, it } from 'vitest';
import { STUDY_CONFIG } from '../game/engine/game';
import type { Frame, Scene } from '../game/types';
import { sceneAt } from '../replay/interp';
import { playScripted } from './testing';
import { CHUNK_SECONDS, createRunRecorder, decodeChunk, dotsAt, laterProgress, resumeAt, type DecodedChunk, type RunChunk } from './runrec';

/** Plays a scripted study game into a run recorder, keeping every 60 Hz scene to check against. */
function play(seconds: number, opts: { seed?: number; firstIndex?: number; startAt?: number } = {}) {
	const chunks: RunChunk[] = [];
	const originals: { frame: Frame; dots: Uint8Array }[] = [];
	let wall = 1_000_000;
	const rec = createRunRecorder({ blockKey: 'b1', firstIndex: opts.firstIndex, startAt: opts.startAt, onChunk: (c) => chunks.push(c), now: () => wall });
	playScripted({ ...STUDY_CONFIG, seed: opts.seed ?? 5 }, seconds, { retreatAt: 0.8 }, (scene: Scene, game) => {
		wall += 1000 / 60;
		originals.push({ frame: scene.frame, dots: scene.dots.slice() });
		rec.push(scene);
		// Steer inputs as the page would see them.
		if (originals.length % 20 === 0) rec.input(scene.frame.player.face);
		void game;
	});
	rec.flush();
	return { chunks, originals, rec };
}

/** The original frame at game time t (the first of equal times, as the recorder keeps it). */
function originalAt(originals: { frame: Frame; dots: Uint8Array }[], t: number) {
	return originals.find((o) => Math.abs(o.frame.t - t) < 0.006) ?? null;
}

describe('full-run recording', () => {
	const run = play(95);
	const decoded = run.chunks.map((c) => decodeChunk(c));

	it('cuts the run into chunks of about 5 s of game time, numbered in order', () => {
		expect(run.chunks.length).toBeGreaterThanOrEqual(18);
		run.chunks.forEach((c, i) => {
			expect(c.i).toBe(i);
			expect(c.t1 - c.t0).toBeLessThanOrEqual(CHUNK_SECONDS + 1e-6);
			if (i > 0) expect(c.t0).toBeGreaterThan(run.chunks[i - 1].t1);
			if (i > 0 && i < run.chunks.length - 1) expect(c.t1 - c.t0).toBeGreaterThan(CHUNK_SECONDS - 0.2);
		});
		// Every scene at 10 Hz.
		for (const d of decoded) for (let s = 1; s < d.scenes.length; s++) expect(d.scenes[s].frame.t - d.scenes[s - 1].frame.t).toBeLessThan(0.12);
	});

	it('gives back every kept scene: positions, modes, power, score and pickups', () => {
		let n = 0;
		for (const d of decoded) {
			for (const s of d.scenes) {
				const o = originalAt(run.originals, s.frame.t);
				expect(o).not.toBeNull();
				const f = o!.frame;
				expect(Math.abs(s.frame.player.x - f.player.x)).toBeLessThan(1 / 64);
				expect(Math.abs(s.frame.player.y - f.player.y)).toBeLessThan(1 / 64);
				s.frame.ghosts.forEach((g, i) => {
					expect(g.id).toBe(f.ghosts[i].id);
					expect(g.mode).toBe(f.ghosts[i].mode);
					expect(g.scared).toBe(f.ghosts[i].scared);
					expect(Math.abs(g.x - f.ghosts[i].x)).toBeLessThan(1 / 64);
				});
				expect(Math.abs(s.frame.power.left - f.power.left)).toBeLessThan(0.006);
				expect(s.frame.power.serial).toBe(f.power.serial);
				expect(s.frame.score).toBe(f.score);
				expect([...s.dots]).toEqual([...o!.dots]);
				n++;
			}
		}
		expect(n).toBeGreaterThan(900);
	});

	it('rebuilds the pickups exactly at any moment, between the 10 Hz scenes too', () => {
		const chunkAt = (t: number) => decoded.find((d, i) => t >= d.scenes[0].frame.t - 1e-9 && (i === decoded.length - 1 || t < decoded[i + 1].scenes[0].frame.t)) as DecodedChunk;
		let changed = 0;
		for (let k = 7; k < run.originals.length; k += 37) {
			const o = run.originals[k];
			const c = chunkAt(o.frame.t);
			if (!c) continue;
			expect([...dotsAt(c, o.frame.t)]).toEqual([...o.dots]);
			changed++;
		}
		expect(changed).toBeGreaterThan(100);
		// Pickups were eaten, and the dot events come back from them.
		expect(decoded.some((d) => d.events.some((e) => e.type === 'dot'))).toBe(true);
		expect(decoded.some((d) => d.events.some((e) => e.type === 'power'))).toBe(true);
	});

	it('interpolates across chunk boundaries like inside a clip', () => {
		const all = decoded.flatMap((d) => d.scenes);
		for (let i = 1; i < decoded.length; i++) {
			const a = decoded[i - 1].scenes.at(-1)!.frame.t, b = decoded[i].scenes[0].frame.t;
			const mid = (a + b) / 2;
			const o = run.originals.reduce((best, x) => (Math.abs(x.frame.t - mid) < Math.abs(best.frame.t - mid) ? x : best));
			const s = sceneAt(all, o.frame.t);
			expect(Math.abs(s.frame.player.x - o.frame.player.x) + Math.abs(s.frame.player.y - o.frame.player.y)).toBeLessThan(0.3);
		}
	});

	it('keeps steer inputs (without repeats) and stores them with their time', () => {
		const inputs = decoded.flatMap((d) => d.inputs);
		expect(inputs.length).toBeGreaterThan(5);
		for (let i = 1; i < inputs.length; i++) {
			expect(inputs[i].t).toBeGreaterThanOrEqual(inputs[i - 1].t);
			expect(inputs[i].dir).not.toBe(inputs[i - 1].dir);
		}
	});

	it('is small: well under 0.5 KB per second of play', () => {
		const bytes = run.chunks.reduce((a, c) => a + c.data.byteLength, 0);
		const perSecond = bytes / (run.chunks.at(-1)!.t1 - run.chunks[0].t0);
		console.log(`full-run recording: ${run.chunks.length} chunks, ${bytes} bytes, ${perSecond.toFixed(0)} B/s, ${(perSecond * 60 / 1024).toFixed(1)} KB/min, ${(bytes / run.chunks.length).toFixed(0)} B/chunk`);
		expect(perSecond).toBeLessThan(500);
	});

	it('a refresh continues the numbering and the run clock', () => {
		const first = play(22, { seed: 8 });
		const progress = laterProgress({ next: first.rec.next, runEnd: first.chunks.at(-1)!.t1 }, null);
		const second = play(22, { seed: 9, firstIndex: progress.next, startAt: resumeAt(progress) });
		expect(second.chunks[0].i).toBe(first.chunks.length);
		expect(second.chunks[0].t0).toBeGreaterThan(first.chunks.at(-1)!.t1);
		const d = decodeChunk(second.chunks[1]);
		// Run time = game time + the page's start.
		expect(d.scenes[0].frame.t).toBeCloseTo(second.chunks[1].t0, 2);
		expect(d.base).toBeCloseTo(resumeAt(progress), 3);
		// The server's note wins when it is further on.
		expect(laterProgress({ next: 2, runEnd: 10 }, { next: 5, runEnd: 30 })).toEqual({ next: 5, runEnd: 30 });
	});

	it('a new game on the same page carries on the run clock', () => {
		const chunks: RunChunk[] = [];
		const rec = createRunRecorder({ blockKey: 'b2', onChunk: (c) => chunks.push(c) });
		for (const seed of [1, 2]) playScripted({ ...STUDY_CONFIG, seed }, 8, { retreatAt: 0.8 }, (scene) => rec.push(scene));
		rec.flush();
		for (let i = 1; i < chunks.length; i++) expect(chunks[i].t0).toBeGreaterThan(chunks[i - 1].t1);
		expect(chunks.some((c) => c.base > 0)).toBe(true);
		expect(decodeChunk(chunks.find((c) => c.base > 0)!).marks.some((m) => m.k === 'game')).toBe(true);
	});

	it('notes land in the chunk they happened in, and trials are listed on it', () => {
		const chunks: RunChunk[] = [];
		const rec = createRunRecorder({ blockKey: 'b3', onChunk: (c) => chunks.push(c) });
		let i = 0;
		playScripted({ ...STUDY_CONFIG, seed: 3 }, 12, { retreatAt: 0.8 }, (scene) => {
			rec.push(scene);
			if (++i === 400) { rec.mark({ k: 'trial', key: 'trial-a', s: 1, e: 2 }); rec.mark({ k: 'pause', wall: 3.2, why: 'blur' }); }
		});
		rec.flush();
		const withTrial = chunks.filter((c) => c.trials?.includes('trial-a'));
		expect(withTrial.length).toBe(1);
		const marks = decodeChunk(withTrial[0]).marks;
		expect(marks.map((m) => m.k)).toEqual(['trial', 'pause']);
		expect(marks[0].t).toBeGreaterThanOrEqual(withTrial[0].t0);
		expect(marks[0].t).toBeLessThanOrEqual(withTrial[0].t1 + 0.1);
	});
});
