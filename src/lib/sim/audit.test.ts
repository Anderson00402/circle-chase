/**
 * The audit: does the stored outcome of a trial match an independent reading of its replay clip?
 *
 * 1. Always: fresh simulated blocks, every trial (also the ones that get no clip in the real
 *    pipeline), measured by the real tracker, clipped by the real recorder, decoded and classified
 *    again by `audit.ts`, which shares no code with the tracker or the rules.
 * 2. On request: the stored trials of a simulator run, from their stored clips.
 *      AUDIT_RUN=<run id> npx vitest run src/lib/sim/audit.test.ts
 *    writes .shots/measures/audit-<run>.json and prints the agreement.
 */
import { describe, expect, it } from 'vitest';
import { createBot } from '../game/engine/bot';
import { createGame, STUDY_CONFIG } from '../game/engine/game';
import { createRecorder, decodeClip, type EncodedClip } from '../telemetry/recorder';
import { createTracker } from '../telemetry/tracker';
import type { TrialMeasures } from '../telemetry/types';
import { auditTrial, pathBetween, type AuditResult } from './audit';
import { distanceField } from '../telemetry/distance';
import { mazeById } from '../game/engine/mazes';

declare const process: { env: Record<string, string | undefined> };

/** Two sampling rates (60 and 20 a second) can land on either side of a line: a call this close is a coin toss, not a disagreement about the definition. */
const CLOSE_CALL = 0.35;

interface Row { stored: TrialMeasures | Record<string, any>; mine: AuditResult; agree: boolean; closeCall: boolean }

function compare(stored: Record<string, any>, mine: AuditResult): Row {
	const agree = stored.outcome === mine.outcome;
	return { stored, mine, agree, closeCall: !agree && mine.margin < CLOSE_CALL };
}

function summary(rows: Row[]) {
	const n = rows.length, agree = rows.filter((r) => r.agree).length, close = rows.filter((r) => r.closeCall).length;
	const by: Record<string, [number, number]> = {};
	for (const r of rows) { const k = r.stored.outcome; by[k] ??= [0, 0]; by[k][0]++; if (r.agree) by[k][1]++; }
	const turns = rows.filter((r) => r.agree && r.stored.lastChaseEnd === 'turn' && r.mine.last?.end === 'turn');
	const err = turns.map((r) => Math.abs(r.stored.turnLeft - r.mine.last!.left)).sort((a, b) => a - b);
	return {
		n, agree, share: n ? agree / n : 1, closeCalls: close, real: n - agree - close, byStoredClass: by,
		engagedAgree: rows.filter((r) => r.stored.engaged === r.mine.engaged).length,
		inRatesAgree: rows.filter((r) => r.stored.inRates === r.mine.inRates).length,
		turnLeftErr: err.length ? { n: err.length, median: +err[err.length >> 1].toFixed(3), p95: +err[Math.floor(err.length * 0.95)].toFixed(3), max: +err[err.length - 1].toFixed(3) } : null
	};
}

describe('audit: an independent reading of the clip gives the stored outcome', () => {
	it('its own path distance agrees with the tracker\'s, tunnels included', () => {
		const m = mazeById('plaza');
		let n = 0;
		for (const [ax, ay, bx, by] of [[1, 9, 23, 9], [0.4, 9, 24.5, 9], [-0.4, 9, 23, 9], [6, 6.5, 12, 13], [12.3, 13, 12.6, 13], [1, 1, 23, 23], [3.5, 1, 6, 4.25]]) {
			expect(pathBetween(m, ax, ay, bx, by)).toBeCloseTo(distanceField(m, ax, ay).to(bx, by), 6);
			n++;
		}
		expect(pathBetween(m, 1, 9, 23, 9)).toBeCloseTo(3, 6); // through the tunnel
		expect(n).toBe(7);
	});

	it('on every trial of fresh simulated blocks', () => {
		const rows: Row[] = [];
		// Players with good and poor timing, careful and reckless, plus one who keeps away from ghosts.
		const players: [number, number, number][] = [
			[1, 0, 1], [2, 0.5, 1], [3, 1, 0.6], [4, 1.5, 1], [5, 2.4, 1], [6, 2.4, 0.2], [7, 1, -0.3], [8, 0, 99], [9, 3, 0.5], [10, 0.3, 1.4],
			[11, 0, 0.5], [12, 2, 0], [13, 1.2, 1.2], [14, 0.8, 0.2], [15, 2.8, 1], [16, 0.4, 0.8]
		];
		for (const [seed, noise, caution] of players) {
			const game = createGame({ ...STUDY_CONFIG, seed: seed * 101 + 7 });
			const bot = createBot(game, { seed, skill: 0.9, awarenessNoise: noise, caution, reaction: 0.4 });
			const tracker = createTracker();
			const recorder = createRecorder();
			const check = (t: TrialMeasures) => {
				const clip = recorder.clipFor(t, 'none');
				if (!clip) return;
				const mine = auditTrial(decodeClip(clip).scenes, { serial: t.serial, startedAt: t.startedAt, endedAt: t.endedAt, total: t.total, endReason: t.endReason, cut: t.after.cut });
				rows.push(compare(t, mine));
			};
			for (let i = 1; i <= 150 * 120; i++) {
				bot.step();
				game.update(1 / 120);
				if (i % 2) continue;
				const scene = game.scene();
				recorder.push(scene);
				for (const t of tracker.onScene(scene)) check(t);
			}
			for (const t of tracker.finish()) check(t);
		}
		const s = summary(rows);
		console.log('audit, fresh blocks', JSON.stringify(s));
		for (const r of rows.filter((x) => !x.agree)) {
			const t = r.stored as TrialMeasures;
			console.log(`  ${r.closeCall ? 'close call' : 'DISAGREE'} serial ${t.serial}: stored ${t.outcome} (last ${t.lastChaseEnd} turn ${t.turnLeft}@${t.turnDist} gain ${t.chaseGain} end ${t.chaseEndDist}) mine ${r.mine.outcome} (last ${r.mine.last?.end} turn ${r.mine.last?.left.toFixed(2)}@${r.mine.last?.dist.toFixed(2)} gain ${r.mine.last?.gain.toFixed(2)} end ${r.mine.last?.atEnd?.toFixed(2)}) margin ${r.mine.margin.toFixed(2)} at ${r.mine.marginAt}`);
		}
		expect(s.n).toBeGreaterThan(150);
		// Every class is exercised.
		for (const k of ['timely-retreat', 'early-retreat', 'overstayed', 'catch', 'not-engaged']) expect(s.byStoredClass[k]?.[0] ?? 0, k).toBeGreaterThanOrEqual(3);
		// No disagreement that is not a close call at a threshold, and few of those.
		expect(s.real).toBe(0);
		expect(s.share).toBeGreaterThan(0.95);
	}, 300_000);
});

describe.runIf(process.env.AUDIT_RUN)('audit: a stored simulator run', () => {
	it('re-classifies every stored clip of the run', async () => {
		const { ConvexHttpClient } = await import('convex/browser');
		const { anyApi: api } = await import('convex/server');
		// Node's file module, without needing its type package.
		const nodeFs = 'node:fs';
		const { writeFileSync, mkdirSync }: { writeFileSync(path: string, text: string): void; mkdirSync(path: string, o: { recursive: boolean }): void } = await import(/* @vite-ignore */ nodeFs);
		const http = new ConvexHttpClient(process.env.AUDIT_URL ?? 'http://127.0.0.1:3210');
		const run = process.env.AUDIT_RUN!;
		const all: any[] = [];
		let cursor: string | null = null;
		do {
			const p: any = await http.query(api.trials.list, { source: 'bot', run, paginationOpts: { numItems: 500, cursor } });
			all.push(...p.page);
			cursor = p.isDone ? null : p.continueCursor;
		} while (cursor);
		const withClip = all.filter((t) => t.clipId);
		const rows: Row[] = [];
		const out: any[] = [];
		for (let i = 0; i < withClip.length; i += 16) {
			await Promise.all(withClip.slice(i, i + 16).map(async (t) => {
				const clip: any = await http.query(api.clips.byTrial, { trialId: t._id });
				if (!clip) return;
				const scenes = decodeClip(clip as EncodedClip).scenes;
				const mine = auditTrial(scenes, { serial: t.serial, startedAt: t.startedAt, endedAt: t.endedAt, total: t.total, endReason: t.endReason, cut: t.after.cut ?? null });
				const row = compare(t, mine);
				rows.push(row);
				const last = scenes.at(-1)!.frame;
				out.push({
					id: t._id, cue: t.cue, agree: row.agree, closeCall: row.closeCall, margin: +mine.margin.toFixed(3), marginAt: mine.marginAt,
					stored: { outcome: t.outcome, engaged: t.engaged, inRates: t.inRates, lastChaseEnd: t.lastChaseEnd, turnLeft: t.turnLeft, turnDist: t.turnDist, chaseGain: t.chaseGain, chaseEndDist: t.chaseEndDist, endDist: t.endDist, died: t.after.died, caught: t.after.caught, gaveUpEarly: t.gaveUpEarly, chaseLog: t.chaseLog },
					mine: { outcome: mine.outcome, engaged: mine.engaged, inRates: mine.inRates, last: mine.last, endDist: mine.endDist, died: mine.died, caught: mine.caught, gaveUpEarly: mine.gaveUpEarly, chases: mine.chases.length },
					// The clip of a trial that ended in a death must end on it.
					deathInClip: t.after.died ? last.phase === 'dying' && scenes.some((s) => s.frame.events.some((e) => e.type === 'die')) : null,
					span: [+(scenes[0].frame.t - t.startedAt).toFixed(2), +(last.t - t.endedAt).toFixed(2)]
				});
			}));
		}
		const s = summary(rows);
		const deaths = out.filter((r) => r.deathInClip !== null);
		const lines: Record<string, number> = {};
		for (const r of out) if (r.closeCall) lines[r.marginAt] = (lines[r.marginAt] ?? 0) + 1;
		const report = {
			run, trials: all.length, clips: withClip.length, audited: rows.length, ...s, closeCallsByLine: lines,
			deathClips: { n: deaths.length, endOnTheDeath: deaths.filter((r) => r.deathInClip).length },
			clipsFromTheStart: out.filter((r) => r.span[0] < 0.06).length,
			disagreements: out.filter((r) => !r.agree)
		};
		mkdirSync('.shots/measures', { recursive: true });
		writeFileSync(`.shots/measures/audit-${run}.json`, JSON.stringify({ report, rows: out }, null, 1));
		const { disagreements, ...head } = report;
		console.log('audit, stored run', JSON.stringify(head, null, 1));
		expect(rows.length).toBeGreaterThan(0);
	}, 1_800_000);
});
