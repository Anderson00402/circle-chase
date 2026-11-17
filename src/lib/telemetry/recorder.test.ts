import { describe, expect, it } from 'vitest';
import { STUDY_CONFIG } from '../game/engine/game';
import type { Frame, Scene } from '../game/types';
import { CLIP_BEFORE, DYING_TAIL, createRecorder, deathAt, decodeClip, type EncodedClip } from './recorder';
import { mazeById } from '../game/engine/mazes';
import { createTracker } from './tracker';
import { playScripted, type Policy } from './testing';
import { createWriteQueue, trialWrite, wantsClip } from './write';
import type { TrialMeasures } from './types';
import { packSeries, unpackSeries } from '#convex/lib/series.ts';

/**
 * Plays a scripted study game, keeping every scene so decoded clips can be checked against it.
 * Trials go through the writer's queue, as in the browser (a trial ended by a death waits for its
 * dying phase).
 */
function record(seconds = 120, policy: Policy = { retreatAt: 0.8 }, seed = 11) {
	const tracker = createTracker();
	const recorder = createRecorder();
	const queue = createWriteQueue();
	const originals = new Map<number, { frame: Frame; dots: Uint8Array }>();
	const clips: { trial: TrialMeasures; clip: EncodedClip }[] = [];
	const trials: TrialMeasures[] = [];
	playScripted({ ...STUDY_CONFIG, seed }, seconds, policy, (scene: Scene) => {
		// Game time stands still during the freeze after an eat, so several frames share one time;
		// the recorder keeps the first of them, and so does this map.
		const k = Math.round(scene.frame.t * 1000);
		if (!originals.has(k)) originals.set(k, { frame: scene.frame, dots: scene.dots.slice() });
		recorder.push(scene);
		for (const trial of tracker.onScene(scene)) queue.add(trial);
		for (const trial of queue.ready(scene.frame.t)) {
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
			// Under study rules (powers of 4-8 s) the window is the whole power-up and its aftermath.
			expect(CLIP_BEFORE).toBe(8);
			const from = trial.startedAt;
			expect(clip.t0).toBeGreaterThanOrEqual(from - 1e-6);
			expect(clip.t0).toBeLessThan(from + 0.06);
			// The last scene is the frame that closed the trial.
			expect(clip.t1).toBeGreaterThan(trial.endedAt + trial.after.seen - 0.02);
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

	it('a clip of a trial that ended in a death shows it: the die event and half a second of the dying phase', () => {
		// A player who never backs off gets caught now and then.
		const deaths = [1, 2, 3, 4].flatMap((seed) => record(150, 'chase', seed).clips).filter((c) => c.trial.after.died);
		expect(deaths.length).toBeGreaterThan(2);
		for (const { trial, clip } of deaths) {
			const { scenes, markers } = decodeClip(clip);
			const last = scenes.at(-1)!.frame;
			const died = trial.endedAt + trial.after.seen;
			expect(deathAt(trial)).toBeCloseTo(died, 2);
			// The clip runs on half a second past the death (within a frame; stored times are rounded).
			expect(Math.abs(last.t - (died + DYING_TAIL))).toBeLessThan(0.06);
			expect(last.phase).toBe('dying');
			const dieAt = scenes.find((s) => s.frame.events.some((e) => e.type === 'die'))!.frame;
			// The die event is on the 20 Hz frame at or just after the death.
			expect(Math.abs(dieAt.t - died)).toBeLessThan(0.06);
			expect(scenes.filter((s) => s.frame.t > died + 0.01).every((s) => s.frame.phase === 'dying')).toBe(true);
			expect(scenes.flatMap((s) => s.frame.events).filter((e) => e.type === 'die')).toHaveLength(1);
			expect(markers.at(-1)!.kind).toBe('death');
			expect(Math.abs(markers.at(-1)!.t - died)).toBeLessThan(0.02);
			// No frame is in the clip twice.
			for (let i = 1; i < scenes.length; i++) expect(scenes[i].frame.t).toBeGreaterThan(scenes[i - 1].frame.t);
		}
	}, 30_000); // ten minutes of scripted play

	it('a clip always ends on the latest frame, on the 20 Hz grid or not', () => {
		for (const { trial, clip } of clips) {
			const death = deathAt(trial);
			const closed = death !== null ? death + DYING_TAIL : trial.endReason === 'expired' ? trial.endedAt + trial.after.seen : trial.endedAt;
			expect(clip.t1).toBeGreaterThan(closed - 0.02);
			expect(clip.t1).toBeLessThan(closed + 0.05 + 1e-6);
		}
	});

	it('no event is lost or doubled when the latest frame is added between grid frames', () => {
		const tracker = createTracker();
		const recorder = createRecorder();
		const eats = new Map<number, number>();
		const seen: EncodedClip[] = [];
		playScripted({ ...STUDY_CONFIG, seed: 5 }, 120, 'chase', (scene: Scene) => {
			recorder.push(scene);
			for (const e of scene.frame.events) if (e.type === 'eat') eats.set(Math.round(e.t * 1000), 1);
			for (const trial of tracker.onScene(scene)) { const c = recorder.clipFor(trial, 'none'); if (c) seen.push(c); }
		});
		expect(seen.length).toBeGreaterThan(3);
		const inClips = new Map<number, number>();
		for (const c of seen) for (const s of decodeClip(c).scenes) for (const e of s.frame.events) if (e.type === 'eat') inClips.set(Math.round(e.t * 1000), (inClips.get(Math.round(e.t * 1000)) ?? 0) + 1);
		expect(eats.size).toBeGreaterThan(3);
		// Every eat of a clipped power-up is in exactly one clip, exactly once.
		for (const [, n] of inClips) expect(n).toBe(1);
	});

	it('a trial closed by leaving the page has a sane end and a clip', () => {
		const tracker = createTracker();
		const recorder = createRecorder();
		let left: { trial: TrialMeasures; clip: EncodedClip | null } | null = null;
		const game = playScripted({ ...STUDY_CONFIG, seed: 3 }, 200, 'chase', (scene: Scene) => {
			if (left) return;
			recorder.push(scene);
			tracker.onScene(scene);
			// Leave in the middle of a chase, with the power still on and inside its last 3 s.
			if (scene.frame.power.left > 0 && scene.frame.power.left < 2.5 && tracker.live.chasing) {
				const [trial] = tracker.finish();
				left = { trial, clip: wantsClip(trial) ? recorder.clipFor(trial, 'none') : null };
			}
		});
		expect(game).toBeTruthy();
		expect(left).not.toBeNull();
		const { trial, clip } = left!;
		expect(trial.endReason).toBe('quit');
		expect(trial.outcome).toBe('interrupted');
		expect(trial.endedAt).toBeGreaterThan(trial.startedAt);
		expect(trial.leftAtEnd).toBeGreaterThan(0);
		expect(trial.endedAt - trial.startedAt).toBeLessThanOrEqual(trial.total);
		expect(trial.engaged).toBe(true);
		expect(clip).not.toBeNull();
		expect(clip!.t0).toBeCloseTo(trial.startedAt, 1);
		expect(clip!.t1).toBeCloseTo(trial.endedAt, 2);
		expect(clip!.markers.find((m) => m.kind === 'powerEnd')!.t).toBeCloseTo(trial.endedAt, 2);
		// The same through the shared write path.
		expect(trialWrite(trial, recorder, { key: 'k', sessionKey: 's', blockKey: 'b', trialIndex: 0, cue: 'none', sound: true, reducedMotion: false, inputType: 'none', difficulty: 'normal' }).clip).toBeTruthy();
	});

	it('every clip knows the layout of its maze', () => {
		for (const { clip } of clips) {
			expect(clip.layout).toBeTruthy();
			expect(clip.layout).toBe(mazeById(clip.mazeId).layout);
			expect(decodeClip(clip).meta.layout).toBe(clip.layout);
		}
	});

	it('the write queue holds a trial ended by a death for its dying phase, and keeps the order', () => {
		const q = createWriteQueue();
		const base = trials.find((t) => !t.after.died && t.endReason === 'expired')!;
		const died = { ...base, serial: 2, after: { ...base.after, died: true, timeToCaught: 1, seen: 1 } };
		const next = { ...base, serial: 3 };
		q.add(died);
		q.add(next);
		const d = deathAt(died)!;
		expect(q.ready(d + 0.2)).toEqual([]);
		expect(q.ready(d + DYING_TAIL).map((t) => t.serial)).toEqual([2, 3]);
		// Time going back (a new game) or the end of a run lets everything go.
		q.add(died);
		expect(q.ready(0).map((t) => t.serial)).toEqual([2]);
		q.add(died);
		expect(q.drain().map((t) => t.serial)).toEqual([2]);
		expect(q.size).toBe(0);
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
