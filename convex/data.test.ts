/**
 * Convex-side tests of the data plumbing, run against an in-memory backend (convex-test):
 * trials.save idempotency and rescoring, the series table, the counters staying equal to a recount,
 * export pagination, run-console participant numbering, and block close (pauses, session end).
 */
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { packSeries } from './lib/series';
import { RULES_VERSION, isDecision, rescore } from './lib/rules';

const modules = import.meta.glob('./**/*.*s');

const device = { userAgent: 'test', platform: 'test', language: 'en', touch: false, screenW: 1, screenH: 1, dpr: 1 };
const series = packSeries({ t: [0, 0.1, 0.2], left: [6, 5.9, 5.8], dist: [4, 3.5, null], chasing: [1, 1, 0], px: [10, 11, 12], py: [5, 5, 5] });

/** Raw measures of a power-up that ran out after the player turned away with 1 s left from a near ghost. */
function measures(over: Record<string, unknown> = {}) {
	return {
		serial: 1, startedAt: 10, endedAt: 16, total: 6, level: 1, mazeId: 'm', endReason: 'expired' as const,
		leftAtEnd: 0, scaredAtStart: 4,
		// Deliberately wrong: the server must recompute it from the measures.
		outcome: 'other' as const,
		engaged: true, inRates: true, eats: [], lateCatch: false, allEatenLeft: null,
		turnLeft: 1, turnDist: 2, turnAt: 15, turnReachable: true, chases: 1, lastChaseEnd: 'turn' as const,
		chaseEndDist: 6, chaseGain: 3, chaseGhost: 'a',
		endDist: 6, endClosing: false,
		after: { seen: 3, died: false, caught: false, timeToCaught: null, killer: null, minDangerDist: 6, nearMiss: false, cut: null },
		reaction: null, wasted: null, diedDuring: false, frames: 360, fps: 60,
		...over
	};
}

async function setup(t: ReturnType<typeof convexTest>, pid = 'p1', source: 'human' | 'bot' = 'human') {
	await t.mutation(api.participants.ensure, { pid, source, device });
	await t.mutation(api.sessions.start, {
		key: `s-${pid}`, pid, mode: 'study', source, cueOrder: ['timer-bar', 'classic-blink'], appVersion: 'test',
		difficulty: 'normal', sound: true, reducedMotion: false, inputType: 'keyboard', viewport: { w: 1, h: 1, dpr: 1 }
	});
	await t.mutation(api.blocks.start, { key: `b-${pid}`, sessionKey: `s-${pid}`, cue: 'timer-bar', orderIndex: 0 });
	return { sessionKey: `s-${pid}`, blockKey: `b-${pid}` };
}

function trialArgs(k: { sessionKey: string; blockKey: string }, key: string, i: number, over: Record<string, unknown> = {}) {
	return {
		key, sessionKey: k.sessionKey, blockKey: k.blockKey, trialIndex: i, sound: true, reducedMotion: false,
		inputType: 'keyboard', appVersion: 'test', difficulty: 'normal', ...measures(over), series
	};
}

describe('trials.save', () => {
	test('is idempotent by key: one trial, one series row, counted once', async () => {
		const t = convexTest(schema, modules);
		const k = await setup(t);
		const a = await t.mutation(api.trials.save, trialArgs(k, 'tr1', 0));
		const b = await t.mutation(api.trials.save, trialArgs(k, 'tr1', 0));
		expect(b.trialId).toBe(a.trialId);
		const rows = await t.run(async (ctx) => ({
			trials: await ctx.db.query('trials').collect(),
			series: await ctx.db.query('trialSeries').collect(),
			counters: await ctx.db.query('counters').collect(),
			block: await ctx.db.query('blocks').first()
		}));
		expect(rows.trials).toHaveLength(1);
		expect(rows.series).toHaveLength(1);
		expect(rows.series[0].trialId).toBe(a.trialId);
		expect(rows.counters.find((c) => c.source === 'human')?.trials).toBe(1);
		expect(rows.block?.trialCount).toBe(1);
		// The row itself carries no series; the query reads it from trialSeries.
		expect((rows.trials[0] as Record<string, unknown>).series).toBeUndefined();
		const s = await t.query(api.trials.series, { trialId: a.trialId });
		expect(s?.left).toEqual([6, 5.9, 5.8]);
		expect(s?.dist).toEqual([4, 3.5, null]);
	});

	test('recomputes the outcome from the measures with the current rules', async () => {
		const t = convexTest(schema, modules);
		const k = await setup(t);
		const { trialId } = await t.mutation(api.trials.save, trialArgs(k, 'tr1', 0));
		const row = await t.run((ctx) => ctx.db.get(trialId));
		const expected = rescore(measures());
		expect(row?.outcome).toBe(expected.outcome);
		expect(row?.outcome).not.toBe('other');
		expect(row?.rulesVersion).toBe(RULES_VERSION);
	});

	test('a row measured before the current rules keeps an older rules version and is reported as left out', async () => {
		const t = convexTest(schema, modules);
		const k = await setup(t);
		await t.mutation(api.trials.save, trialArgs(k, 'old', 0, { lastChaseEnd: undefined, chaseEndDist: undefined, outcome: 'timely-retreat' }));
		const sum = await t.query(api.summary.byCue, {});
		expect(sum.all.decisions).toBe(0);
		expect(sum.leftOut.oldRules).toBe(1);
		const live = await t.query(api.live.counters, {});
		expect(live.leftOut.oldRules).toBe(1);
	});
});

describe('counters', () => {
	test('stay equal to a recount of the tables', async () => {
		const t = convexTest(schema, modules);
		const k1 = await setup(t, 'p1');
		const k2 = await setup(t, 'p2', 'bot');
		const variants = [{}, { turnLeft: 3, turnDist: 4 }, { endReason: 'died' }, { lastChaseEnd: null, engaged: false }, { after: { ...measures().after, caught: true }, endDist: 2 }];
		let i = 0;
		for (const k of [k1, k2]) for (const v of variants) await t.mutation(api.trials.save, trialArgs(k, `t${i}`, i++, v));
		await t.mutation(api.trials.save, trialArgs(k1, 't0', 0)); // a retry
		const { counters, trials, sessions, participants } = await t.run(async (ctx) => ({
			counters: await ctx.db.query('counters').collect(),
			trials: await ctx.db.query('trials').collect(),
			sessions: await ctx.db.query('sessions').collect(),
			participants: await ctx.db.query('participants').collect()
		}));
		for (const src of ['human', 'bot'] as const) {
			const c = counters.find((x) => x.source === src)!;
			const ts = trials.filter((x) => x.source === src);
			expect(c.trials).toBe(ts.length);
			expect(c.engaged).toBe(ts.filter((x) => x.engaged).length);
			expect(c.inRates).toBe(ts.filter((x) => x.inRates).length);
			expect(c.decisions).toBe(ts.filter(isDecision).length);
			expect(c.clips).toBe(ts.filter((x) => x.clipId).length);
			expect(c.sessions).toBe(sessions.filter((x) => x.source === src).length);
			expect(c.participants).toBe(participants.filter((x) => x.source === src).length);
		}
	});
});

describe('exports.page', () => {
	test('small pages give exactly the rows of one big page, in order', async () => {
		const t = convexTest(schema, modules);
		const k = await setup(t);
		for (let i = 0; i < 7; i++) await t.mutation(api.trials.save, trialArgs(k, `t${i}`, i));
		await t.mutation(api.runs.setup, { sessionKey: k.sessionKey, run: { participantLabel: 'P01', participantNumber: 1, orderRow: 0 } });
		for (const format of ['csv', 'json'] as const) {
			const one = await t.query(api.exports.page, { format, kind: 'trials', paginationOpts: { numItems: 100, cursor: null } });
			const rows: unknown[] = [];
			let cursor: string | null = null, pages = 0;
			for (;;) {
				const p: { rows: unknown[]; isDone: boolean; continueCursor: string } = await t.query(api.exports.page, { format, kind: 'trials', paginationOpts: { numItems: 2, cursor } });
				rows.push(...p.rows);
				pages++;
				if (p.isDone) break;
				cursor = p.continueCursor;
			}
			expect(pages).toBeGreaterThanOrEqual(4);
			expect(rows).toEqual(one.rows);
			expect(rows).toHaveLength(7);
			if (format === 'csv') {
				const head = one.header!.split(',');
				for (const c of ['participantLabel', 'participantNumber', 'runNumber', 'orderRow', 'blockIndex', 'pauses', 'pausedSeconds', 'rulesVersion', 'simRun', 'decision'])
					expect(head).toContain(c);
				const first = (rows[0] as string).split(',');
				expect(first[head.indexOf('participantLabel')]).toBe('P01');
				expect(first[head.indexOf('orderRow')]).toBe('0');
			} else {
				expect((rows[0] as { series: { t: number[] } }).series.t).toHaveLength(3);
			}
		}
	});

	test('ratings and blocks export with the filter', async () => {
		const t = convexTest(schema, modules);
		const k = await setup(t);
		await setup(t, 'bot1', 'bot');
		await t.mutation(api.ratings.saveBlock, { key: 'r1', blockKey: k.blockKey, clarity: 5, distraction: 2 });
		await t.mutation(api.blocks.end, { key: k.blockKey, deaths: 1, score: 100, pauses: 2, pausedSeconds: 4.5 });
		const r = await t.query(api.exports.page, { format: 'csv', kind: 'ratings', paginationOpts: { numItems: 50, cursor: null } });
		expect(r.rows).toHaveLength(1);
		const b = await t.query(api.exports.page, { format: 'csv', kind: 'blocks', paginationOpts: { numItems: 50, cursor: null } });
		expect(b.rows).toHaveLength(1); // the bot's block is left out (source defaults to human)
		const head = b.header!.split(','), row = (b.rows[0] as string).split(',');
		expect(row[head.indexOf('pauses')]).toBe('2');
		expect(row[head.indexOf('pausedSeconds')]).toBe('4.5');
		expect(row[head.indexOf('clarity')]).toBe('5');
	});
});

describe('export downloads (HTTP)', () => {
	/** Download one file through the real route; fails the test if it does not finish in time. */
	async function get(t: ReturnType<typeof convexTest>, path: string): Promise<string> {
		const res = await Promise.race([
			t.fetch(path, { method: 'GET' }).then((r) => r.text()),
			new Promise<never>((_, no) => setTimeout(() => no(new Error(`${path} did not finish`)), 5000))
		]);
		return res;
	}

	test('finish with every matching row when most pages match nothing (human rows among bot rows)', async () => {
		const t = convexTest(schema, modules);
		// Bot rows first, then one human block, rating and trial, then more bot rows: with pages of one
		// row nearly every page holds nothing for the human filter.
		const bots = [];
		for (let i = 0; i < 4; i++) bots.push(await setup(t, `bot${i}`, 'bot'));
		const h = await setup(t, 'human1');
		for (let i = 4; i < 7; i++) bots.push(await setup(t, `bot${i}`, 'bot'));
		let n = 0;
		for (const k of bots) {
			await t.mutation(api.trials.save, trialArgs(k, `bt${n}`, 0));
			await t.mutation(api.ratings.saveBlock, { key: `br${n++}`, blockKey: k.blockKey, clarity: 4, distraction: 4 });
		}
		await t.mutation(api.trials.save, trialArgs(h, 'ht', 0));
		await t.mutation(api.ratings.saveBlock, { key: 'hr', blockKey: h.blockKey, clarity: 6, distraction: 1 });
		for (const kind of ['trials', 'ratings', 'blocks']) {
			for (const size of ['', '&pageSize=1', '&pageSize=2']) {
				const csv = await get(t, `/export/${kind}.csv?source=human${size}`);
				expect(csv.trim().split('\n'), `${kind}.csv${size}`).toHaveLength(2);
				const json = JSON.parse(await get(t, `/export/${kind}.json?source=human${size}`));
				expect(json, `${kind}.json${size}`).toHaveLength(1);
				const bot = JSON.parse(await get(t, `/export/${kind}.json?source=bot${size}`));
				expect(bot, `${kind}.json bot${size}`).toHaveLength(7);
			}
			// A filter that matches nothing still ends: a header alone, an empty array.
			expect((await get(t, `/export/${kind}.csv?source=human&cue=nothing&pageSize=1`)).trim().split('\n')).toHaveLength(1);
			expect(JSON.parse(await get(t, `/export/${kind}.json?source=bot&run=nothing&pageSize=1`))).toEqual([]);
		}
	});
});

describe('participants.ensure numbering', () => {
	test('run-console participants are numbered on their own, per source; play pages use no number', async () => {
		const t = convexTest(schema, modules);
		const play = await t.mutation(api.participants.ensure, { pid: 'browser', source: 'human', device });
		expect(play.runNumber).toBeNull();
		await t.mutation(api.participants.ensure, { pid: 'bot-x', source: 'bot', device });
		const p1 = await t.mutation(api.participants.ensure, { pid: 'run-1', source: 'human', device, console: true, nickname: 'P01' });
		const b1 = await t.mutation(api.participants.ensure, { pid: 'bot-run-1', source: 'bot', device, console: true });
		const p2 = await t.mutation(api.participants.ensure, { pid: 'run-2', source: 'human', device, console: true });
		expect([p1.runNumber, p2.runNumber, b1.runNumber]).toEqual([1, 2, 1]);
		expect(p2.number).toBe(5); // the overall number still counts everyone
		// Asking again keeps the number; a participant first seen on a play page gets one when the console asks.
		expect((await t.mutation(api.participants.ensure, { pid: 'run-1', source: 'human', device, console: true })).runNumber).toBe(1);
		expect((await t.mutation(api.participants.ensure, { pid: 'browser', source: 'human', device, console: true })).runNumber).toBe(3);
		expect((await t.mutation(api.participants.ensure, { pid: 'browser', source: 'human', device })).runNumber).toBe(3);
	});
});

describe('blocks.end', () => {
	test('stores pauses and closes the session when its last open block closes', async () => {
		const t = convexTest(schema, modules);
		const k = await setup(t);
		await t.mutation(api.blocks.start, { key: 'b2', sessionKey: k.sessionKey, cue: 'classic-blink', orderIndex: 1 });
		await t.mutation(api.blocks.end, { key: k.blockKey, deaths: 0, score: 1, pauses: 1, pausedSeconds: 2 });
		let s = await t.run((ctx) => ctx.db.query('sessions').first());
		expect(s?.endedAt).toBeUndefined();
		await t.mutation(api.blocks.end, { key: 'b2', deaths: 0, score: 1 });
		s = await t.run((ctx) => ctx.db.query('sessions').first());
		expect(s?.endedAt).toBeTypeOf('number');
		// A new block opens it again.
		await t.mutation(api.blocks.start, { key: 'b3', sessionKey: k.sessionKey, cue: 'timer-bar', orderIndex: 2 });
		s = await t.run((ctx) => ctx.db.query('sessions').first());
		expect(s?.endedAt).toBeUndefined();
		const b = await t.run((ctx) => ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', k.blockKey)).unique());
		expect([b?.pauses, b?.pausedSeconds]).toEqual([1, 2]);
	});

	test('a run resumed after a refresh adds up the deaths, score and pauses of every page, in any order', async () => {
		const t = convexTest(schema, modules);
		const k = await setup(t);
		const block = () => t.run((ctx) => ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', k.blockKey)).unique());
		const session = () => t.run((ctx) => ctx.db.query('sessions').first());
		// Page A plays, then the tab is refreshed: page B resumes the block before A's last write arrives.
		await t.mutation(api.blocks.start, { key: k.blockKey, sessionKey: k.sessionKey, cue: 'timer-bar', orderIndex: 0, segment: 'A' });
		for (let i = 0; i < 3; i++) await t.mutation(api.trials.save, trialArgs(k, `a${i}`, i));
		await t.mutation(api.blocks.start, { key: k.blockKey, sessionKey: k.sessionKey, cue: 'timer-bar', orderIndex: 0, segment: 'B' });
		expect((await t.query(api.blocks.progress, { key: k.blockKey }))).toMatchObject({ trials: 3, nextIndex: 3, segments: 2 });
		// A's close (delivered later from the closed page's queue) does not end the block B is playing.
		await t.mutation(api.blocks.end, { key: k.blockKey, deaths: 2, score: 1500, pauses: 1, pausedSeconds: 3.2, segment: 'A' });
		expect((await block())?.endedAt).toBeUndefined();
		expect((await session())?.endedAt).toBeUndefined();
		await t.mutation(api.trials.save, trialArgs(k, 'b0', 3));
		await t.mutation(api.blocks.end, { key: k.blockKey, deaths: 1, score: 400, pauses: 2, pausedSeconds: 1.1, segment: 'B' });
		// A retry of A's close changes nothing.
		await t.mutation(api.blocks.end, { key: k.blockKey, deaths: 2, score: 1500, pauses: 1, pausedSeconds: 3.2, segment: 'A' });
		const b = await block();
		expect([b?.deaths, b?.score, b?.pauses, b?.pausedSeconds]).toEqual([3, 1900, 3, 4.3]);
		expect(b?.endedAt).toBeTypeOf('number');
		expect((await session())?.endedAt).toBeTypeOf('number');
		const p = await t.query(api.blocks.progress, { key: k.blockKey });
		expect(p).toMatchObject({ trials: 4, nextIndex: 4, deaths: 3, score: 1900 });
		expect(await t.query(api.blocks.progress, { key: 'nope' })).toBeNull();
	});

	test('a page that crashed without closing does not keep a resumed block open', async () => {
		const t = convexTest(schema, modules);
		const k = await setup(t);
		await t.mutation(api.blocks.start, { key: k.blockKey, sessionKey: k.sessionKey, cue: 'timer-bar', orderIndex: 0, segment: 'A' });
		await t.mutation(api.blocks.start, { key: k.blockKey, sessionKey: k.sessionKey, cue: 'timer-bar', orderIndex: 0, segment: 'B' });
		await t.mutation(api.blocks.end, { key: k.blockKey, deaths: 0, score: 10, segment: 'B' });
		const b = await t.run((ctx) => ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', k.blockKey)).unique());
		expect(b?.endedAt).toBeTypeOf('number');
		expect(b?.score).toBe(10);
	});

	test('notes for a block that has not arrived yet answer null (the outbox waits)', async () => {
		const t = convexTest(schema, modules);
		expect(await t.mutation(api.blocks.end, { key: 'nope', deaths: 0, score: 0 })).toBeNull();
		expect(await t.mutation(api.ratings.saveBlock, { key: 'r', blockKey: 'nope', clarity: 3, distraction: 3 })).toBeNull();
		expect(await t.mutation(api.runs.setup, { sessionKey: 'nope', run: { participantLabel: 'x', participantNumber: 1, orderRow: 0 } })).toBeNull();
	});
});
