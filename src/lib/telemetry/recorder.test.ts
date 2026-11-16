import { describe, expect, it } from 'vitest';
import { STUDY_CONFIG } from '../game/engine/game';
import type { Frame, Scene } from '../game/types';
import { createRecorder, decodeClip, type EncodedClip } from './recorder';
import { createTracker } from './tracker';
import { playScripted } from './testing';
import type { TrialMeasures } from './types';
import { packSeries, unpackSeries } from '#convex/lib/series.ts';

/** Plays a scripted study game, keeping every scene so decoded clips can be checked against it. */
function record(seconds = 120) {
	const tracker = createTracker();
	const recorder = createRecorder();
	const originals = new Map<number, { frame: Frame; dots: Uint8Array }>();
	const clips: { trial: TrialMeasures; clip: EncodedClip }[] = [];
	const trials: TrialMeasures[] = [];
	playScripted({ ...STUDY_CONFIG, seed: 11 }, seconds, { retreatAt: 0.8 }, (scene: Scene) => {
		originals.set(Math.round(scene.frame.t * 1000), { frame: scene.frame, dots: scene.dots.slice() });
		recorder.push(scene);
		for (const trial of tracker.onScene(scene)) {
			trials.push(trial);
			const clip = recorder.clipFor(trial, 'timer-bar');
			if (clip) clips.push({ trial, clip });
		}
	});
	return { clips, originals, trials };
}

describe('clips', () => {
	const { clips, originals, trials } = record();

	it('cuts the STUDY.md window and stays small', () => {
		const expired = clips.filter((c) => c.trial.endReason === 'expired');
		expect(expired.length).toBeGreaterThan(2);
		for (const { trial, clip } of expired) {
			const from = Math.max(trial.startedAt, trial.endedAt - 6);
			expect(clip.t0).toBeGreaterThanOrEqual(from - 1e-6);
			expect(clip.t0).toBeLessThan(from + 0.06);
			expect(clip.t1).toBeGreaterThan(trial.endedAt + trial.after.seen - 0.06);
			expect(clip.hz).toBe(20);
			expect(clip.scenes).toBeGreaterThan((clip.t1 - clip.t0) * 20 - 2);
			expect(clip.data.byteLength).toBeLessThan(100_000);
			expect(clip.markers.map((m) => m.kind)).toContain('powerEnd');
		}
		const sizes = expired.map((c) => c.clip.data.byteLength);
		console.log('clip bytes', { n: sizes.length, min: Math.min(...sizes), max: Math.max(...sizes), mean: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) });
	});

	it('decodes back to scenes that match the originals', () => {
		for (const { clip } of clips) {
			const { scenes, markers, meta } = decodeClip(clip);
			expect(scenes).toHaveLength(clip.scenes);
			expect(markers).toEqual(clip.markers);
			expect(meta.numbers).toEqual(clip.numbers);
			for (const s of scenes) {
				const o = originals.get(Math.round(s.frame.t * 1000)) ?? nearest(originals, s.frame.t);
				const f = o.frame;
				expect(s.maze.id).toBe(f.mazeId);
				expect(s.frame.t).toBeCloseTo(f.t, 2);
				expect(s.frame.phase).toBe(f.phase);
				expect(s.frame.score).toBe(f.score);
				expect(s.frame.level).toBe(f.level);
				expect(Math.abs(s.frame.player.x - f.player.x)).toBeLessThanOrEqual(1 / 128 + 1e-9);
				expect(Math.abs(s.frame.player.y - f.player.y)).toBeLessThanOrEqual(1 / 128 + 1e-9);
				expect(s.frame.player.dir).toBe(f.player.dir);
				s.frame.ghosts.forEach((g, i) => {
					const og = f.ghosts[i];
					expect(g.id).toBe(og.id);
					expect(g.mode).toBe(og.mode);
					expect(g.scared).toBe(og.scared);
					expect(g.dir).toBe(og.dir);
					expect(Math.abs(g.x - og.x)).toBeLessThanOrEqual(1 / 128 + 1e-9);
					expect(g.revertedAt).toBeCloseTo(og.revertedAt, 2);
					expect(g.eatenAt).toBeCloseTo(og.eatenAt, 2);
				});
				expect(s.frame.power.left).toBeCloseTo(f.power.left, 2);
				expect(s.frame.power.total).toBeCloseTo(f.power.total, 3);
				expect(s.frame.power.endReason).toBe(f.power.endReason);
				expect(s.frame.power.serial).toBe(f.power.serial);
				expect(s.frame.bonus === null).toBe(f.bonus === null);
				expect(s.frame.popups.map((p) => p.text)).toEqual(f.popups.map((p) => p.text));
				expect([...s.dots]).toEqual([...o.dots]);
			}
		}
	});

	it('keeps eat events and markers for eats', () => {
		const withEat = clips.find((c) => c.trial.eats.length > 0);
		expect(withEat).toBeTruthy();
		const { scenes, markers } = decodeClip(withEat!.clip);
		expect(markers.filter((m) => m.kind === 'eat').length).toBe(withEat!.trial.eats.length);
		const inClip = withEat!.trial.eats.filter((e) => withEat!.trial.startedAt + e.t >= withEat!.clip.t0);
		const eatEvents = scenes.flatMap((s) => s.frame.events.filter((e) => e.type === 'eat'));
		expect(eatEvents.length).toBe(inClip.length);
	});

	it('series pack round trip', () => {
		for (const t of trials) {
			const packed = packSeries(t.series);
			expect(packed.byteLength).toBeLessThan(2000);
			expect(unpackSeries(packed)).toEqual(t.series);
		}
	});
});

function nearest(map: Map<number, { frame: Frame; dots: Uint8Array }>, t: number) {
	let best: { frame: Frame; dots: Uint8Array } | null = null, bd = Infinity;
	for (const [k, v] of map) { const d = Math.abs(k / 1000 - t); if (d < bd) { bd = d; best = v; } }
	return best!;
}
