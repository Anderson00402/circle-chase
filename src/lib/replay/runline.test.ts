import { describe, expect, it } from 'vitest';
import { STUDY_CONFIG } from '../game/engine/game';
import type { GameEvent } from '../game/types';
import { createRunRecorder, decodeChunk, resumeAt, type RunChunk } from '../telemetry/runrec';
import { createTracker } from '../telemetry/tracker';
import { playScripted } from '../telemetry/testing';
import type { TrialMeasures } from '../telemetry/types';
import { createWriteQueue } from '../telemetry/write';
import { LEAD, clock, extraMarks, jumpPoints, nextJump, spanAt, spansOf, trialBase, type RunTrial } from './runline';

/** A scripted run recorded like the browser does, with its trials stored (and marked) as they close. */
function scriptedRun(seconds: number, seed: number, rec: ReturnType<typeof createRunRecorder>, trials: { m: TrialMeasures; key: string }[]) {
	const tracker = createTracker(), queue = createWriteQueue();
	playScripted({ ...STUDY_CONFIG, seed }, seconds, { retreatAt: 1 }, (scene) => {
		rec.push(scene);
		for (const t of tracker.onScene(scene)) queue.add(t);
		for (const m of queue.ready(scene.frame.t)) {
			const key = `k${trials.length}`;
			trials.push({ m, key });
			rec.mark({ k: 'trial', key, s: m.startedAt, e: m.endedAt });
		}
	});
}

const asRunTrial = ({ m, key }: { m: TrialMeasures; key: string }, n: number): RunTrial => ({
	_id: `id${n}`, key, n: n + 1, createdAt: 0, outcome: m.outcome, startedAt: m.startedAt, endedAt: m.endedAt, total: m.total,
	endReason: m.endReason, leftAtEnd: m.leftAtEnd, turnAt: m.turnAt, turnLeft: m.turnLeft, turnDist: m.turnDist, endDist: m.endDist,
	lastChaseEnd: m.lastChaseEnd ?? null, eats: m.eats.map((e) => ({ t: e.t, ghost: e.ghost, left: e.left })),
	after: { died: m.after.died, caught: m.after.caught, timeToCaught: m.after.timeToCaught, seen: m.after.seen, killer: m.after.killer }, clipId: null
});

describe('run timeline', () => {
	// Two pages of one run: a refresh after 60 s, the second page's game time starts again at 0.
	const chunks: RunChunk[] = [];
	const trials: { m: TrialMeasures; key: string }[] = [];
	const first = createRunRecorder({ blockKey: 'b', onChunk: (c) => chunks.push(c) });
	scriptedRun(60, 4, first, trials);
	first.flush();
	const nFirst = trials.length;
	const progress = { next: first.next, runEnd: chunks.at(-1)!.t1 };
	const second = createRunRecorder({ blockKey: 'b', firstIndex: progress.next, startAt: resumeAt(progress), onChunk: (c) => chunks.push(c) });
	scriptedRun(60, 6, second, trials);
	second.flush();
	const heads = chunks.map((c) => ({ i: c.i, base: c.base, t0: c.t0, t1: c.t1, at: c.at, end: c.end, trials: c.trials ?? [] }));
	const runTrials = trials.map(asRunTrial);
	const spans = spansOf(runTrials, heads);

	it('places every power-up of both pages on the run clock', () => {
		expect(nFirst).toBeGreaterThan(2);
		expect(trials.length).toBeGreaterThan(nFirst + 2);
		expect(spans.length).toBe(trials.length);
		for (const s of spans) {
			const page2 = trials.findIndex((t) => t.key === s.trial.key) >= nFirst;
			expect(s.base).toBe(page2 ? resumeAt(progress) : 0);
			expect(s.start).toBeCloseTo(s.base + s.trial.startedAt, 6);
		}
		// In order, never overlapping (one power-up at a time under study rules).
		for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThan(spans[i - 1].end);
	});

	it('puts each jump point two seconds before the turn-away, else before the end of the power', () => {
		for (const s of spans) {
			const turn = s.markers.find((m) => m.kind === 'turnAway');
			const key = turn ? turn.t : s.base + s.trial.endedAt;
			expect(s.key).toBeCloseTo(key, 6);
			expect(s.keyKind).toBe(turn ? 'turnAway' : 'powerEnd');
			expect(s.jump).toBeCloseTo(Math.max(s.start - 0.5, key - LEAD), 6);
		}
		expect(spans.some((s) => s.keyKind === 'turnAway')).toBe(true);
		expect(jumpPoints(spans)).toEqual(spans.map((s) => s.jump));
	});

	it('the jump points land on the recording: the board there is inside that power-up', () => {
		const decoded = chunks.map((c) => decodeChunk(c));
		for (const s of spans) {
			const at = s.jump + LEAD - 0.05;
			const d = decoded.find((c) => c.scenes[0].frame.t <= at && c.scenes.at(-1)!.frame.t >= at);
			expect(d).toBeTruthy();
			const scene = d!.scenes.reduce((a, b) => (Math.abs(b.frame.t - at) < Math.abs(a.frame.t - at) ? b : a));
			// Before the key moment the power of this trial is on (or just ending at it).
			expect(scene.frame.power.startedAt).toBeCloseTo(s.start, 1);
		}
	});

	it('steps through the jump points with next and previous', () => {
		let t = 0;
		const seen: number[] = [];
		for (let s = nextJump(spans, t, 1); s; s = nextJump(spans, t, 1)) { seen.push(s.jump); t = s.jump; }
		expect(seen).toEqual(jumpPoints(spans));
		expect(nextJump(spans, t, -1)?.jump).toBe(seen.at(-2));
		expect(spanAt(spans, spans[1].key)?.trial.key).toBe(spans[1].trial.key);
	});

	it('falls back to the wall clock when no chunk lists a trial', () => {
		const t = runTrials[nFirst];
		const unlisted = heads.map((h) => ({ ...h, trials: [] }));
		// Stored after every chunk of page 2 began: the latest chunk holding its game time wins.
		expect(trialBase({ ...t, createdAt: Infinity }, unlisted)).toBe(resumeAt(progress));
	});

	it('marks deaths outside power-ups and bonus pickups', () => {
		const ev: { type: GameEvent['type']; t: number }[] = [
			{ type: 'die', t: spans[0].start - 5 }, { type: 'die', t: spans[0].end + 0.5 }, { type: 'bonus', t: 3 }
		];
		const x = extraMarks(ev, spans);
		expect(x.map((m) => m.kind).sort()).toEqual(['bonus', 'death']);
		expect(x.find((m) => m.kind === 'death')!.t).toBe(spans[0].start - 5);
	});

	it('writes run times as m:ss.s', () => {
		expect(clock(65.34)).toBe('1:05.3');
		expect(clock(5)).toBe('0:05.0');
		expect(clock(125, 0)).toBe('2:05');
		expect(clock(59.6, 0)).toBe('1:00');
		expect(clock(119.97)).toBe('2:00.0');
	});
});
