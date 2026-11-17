/**
 * Digests kept in chunks (convex/lib/digest.ts, convex/lib/replayDigest.ts) against one document
 * per session, as before chunks: every dashboard and replay query gives the same answer, and the
 * bytes a session's saves write shrink. Runs against an in-memory backend (convex-test).
 */
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { packSeries } from './lib/series';
import { DIGEST_CHUNK, setDigestChunkForTests } from './lib/digest';
import { setReplayChunkForTests } from './lib/replayDigest';

const modules = import.meta.glob('./**/*.*s');
const device = { userAgent: 'test', platform: 'test', language: 'en', touch: false, screenW: 1, screenH: 1, dpr: 1 };

/** Small seeded generator, so both backends get the same trials. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A varied power-up: turned in time, too early, stayed, caught, cut by a clear, with or without a clip. */
function trialArgs(r: () => number, sessionKey: string, blockKey: string, key: string, i: number, cue: string) {
	const kind = Math.floor(r() * 5);
	const turnLeft = kind === 0 ? 1 : kind === 1 ? 3.5 : kind === 4 ? 1.2 : null;
	const caught = kind === 3;
	const n = 30;
	const series = packSeries({
		t: Array.from({ length: n }, (_, k) => k / 10), left: Array.from({ length: n }, (_, k) => 6 - k / 5),
		dist: Array.from({ length: n }, () => Math.round(r() * 80) / 10), chasing: Array.from({ length: n }, (_, k) => (k < 20 ? 1 : 0)),
		px: Array.from({ length: n }, () => 5), py: Array.from({ length: n }, () => 5)
	});
	const outcome = 'other' as const;
	const withClip = kind !== 1 || r() < 0.5;
	return {
		key, sessionKey, blockKey, trialIndex: i, sound: r() < 0.7, reducedMotion: false, inputType: 'keyboard', appVersion: 'test', difficulty: 'normal',
		serial: i + 1, startedAt: 10, endedAt: 16, total: 4 + Math.round(r() * 40) / 10, level: 1, mazeId: 'm', endReason: 'expired' as const,
		leftAtEnd: 0, scaredAtStart: 4, outcome, engaged: kind !== 1, inRates: true, eats: [], lateCatch: false, allEatenLeft: null,
		turnLeft, turnDist: turnLeft === null ? null : 2, turnAt: turnLeft === null ? null : 15, turnReachable: true, chases: 1,
		lastChaseEnd: turnLeft === null ? ('open' as const) : ('turn' as const),
		chaseEndDist: turnLeft === null ? 2 : 6, chaseGain: 3, chaseGhost: 'a', gaveUpEarly: kind === 1,
		endDist: turnLeft === null ? 2 : 6, endClosing: false,
		after: { seen: kind === 4 ? 1 : 3, died: caught, caught, timeToCaught: caught ? 1 : null, killer: caught ? 'a' : null, minDangerDist: caught ? 0 : 6, nearMiss: false, cut: kind === 4 ? ('clear' as const) : null },
		reaction: null, wasted: null, diedDuring: false, frames: 360, fps: 60, series,
		...(withClip ? {
			clip: {
				v: 1, cue, mazeId: 'm', level: 1, t0: 0, t1: 9, hz: 20, scenes: 3, markers: [],
				numbers: { outcome, total: 6, turnLeft, turnDist: null, endDist: null, timeToCaught: null, eats: 0, engaged: true },
				data: new Uint8Array(64).buffer
			}
		} : {})
	};
}

const CUES = ['timer-bar', 'classic-blink', 'ink-refill'];

/** Two participants, three runs each, `per` power-ups a run. Returns the bytes each digest write left behind. */
async function play(t: ReturnType<typeof convexTest>, per: number) {
	const r = rng(11);
	let digestBytes = 0, replayBytes = 0;
	for (const pid of ['p1', 'p2']) {
		await t.mutation(api.participants.ensure, { pid, source: 'human', device });
		const sessionKey = `s-${pid}`;
		await t.mutation(api.sessions.start, {
			key: sessionKey, pid, mode: 'study', source: 'human', cueOrder: CUES, appVersion: 'test',
			difficulty: 'normal', sound: true, reducedMotion: false, inputType: 'keyboard', viewport: { w: 1, h: 1, dpr: 1 }
		});
		for (const [b, cue] of CUES.entries()) {
			const blockKey = `${sessionKey}-b${b}`;
			await t.mutation(api.blocks.start, { key: blockKey, sessionKey, cue, orderIndex: b });
			for (let i = 0; i < per; i++) {
				const key = `${blockKey}-t${i}`;
				const { trialId } = await t.mutation(api.trials.save, trialArgs(r, sessionKey, blockKey, key, i, cue));
				// The document this save rewrote: the digest (chunk) holding the new row.
				const written = await t.run(async (ctx) => {
					const ds = await ctx.db.query('trialDigests').collect();
					const rs = await ctx.db.query('replayDigests').collect();
					const d = ds.find((x) => x.rows.some((row: { id: string }) => row.id === trialId));
					const rd = rs.find((x) => x.rows.some((row: { id: string }) => row.id === trialId));
					const size = (x: unknown) => (x ? JSON.stringify(x, (_k, v) => (v instanceof ArrayBuffer ? 'x'.repeat(Math.ceil(v.byteLength * 4 / 3)) : v)).length : 0);
					return { d: size(d), r: size(rd) };
				});
				digestBytes += written.d;
				replayBytes += written.r;
			}
		}
	}
	return { digestBytes, replayBytes };
}

/** Everything the dashboard and the replay browser show for the human data. */
async function answers(t: ReturnType<typeof convexTest>) {
	const f = { source: 'human' as const };
	const strip = <T>(x: T): T => JSON.parse(JSON.stringify(x, (_k, v) => (v instanceof ArrayBuffer ? [...new Uint8Array(v)] : v)));
	return strip({
		main: await t.query(api.dashboard.main, f),
		main25: await t.query(api.dashboard.main, { ...f, line: 2.5 }),
		points: await t.query(api.dashboard.points, f),
		approach: await t.query(api.dashboard.approach, f),
		recent: await t.query(api.dashboard.recent, { ...f, limit: 200 }),
		sessions: await t.query(api.dashboard.sessions, f),
		// A period that cuts through the sessions: the totals are worked out again from the rows.
		period: await t.query(api.dashboard.main, { ...f, from: 0, to: (await t.run(async (ctx) => (await ctx.db.query('trials').collect())[20].createdAt)) }),
		replays: await t.query(api.replays.list, { source: 'human', limit: 500 }),
		replaysTurn: await t.query(api.replays.list, { source: 'human', sort: 'turn-early', limit: 500 })
	});
}

afterEach(() => {
	setDigestChunkForTests(DIGEST_CHUNK);
	setReplayChunkForTests(DIGEST_CHUNK);
});

describe('chunked digests', () => {
	test('give the same answers as one document per session, and write far fewer bytes', async () => {
		const per = 40; // 120 power-ups per session
		setDigestChunkForTests(7);
		setReplayChunkForTests(7);
		const chunked = convexTest(schema, modules);
		const small = await play(chunked, per);
		const docs = await chunked.run(async (ctx) => ({
			d: (await ctx.db.query('trialDigests').collect()).length,
			r: (await ctx.db.query('replayDigests').collect()).length
		}));
		expect(docs.d).toBe(2 * Math.ceil((3 * per) / 7));
		expect(docs.r).toBeGreaterThan(2);
		const a = await answers(chunked);

		// The same data rebuilt as one document per session (the layout before chunks).
		setDigestChunkForTests(Infinity);
		setReplayChunkForTests(Infinity);
		for (let cursor: string | null = null, done = false; !done;) {
			const p: { cursor: string; isDone: boolean } = await chunked.mutation(internal.dashboard.rebuildDigests, { cursor });
			cursor = p.cursor; done = p.isDone;
		}
		for (let cursor: string | null = null, done = false; !done;) {
			const p: { cursor: string; isDone: boolean } = await chunked.mutation(internal.replays.rebuildDigests, { cursor });
			cursor = p.cursor; done = p.isDone;
		}
		expect((await chunked.run(async (ctx) => ctx.db.query('trialDigests').collect())).length).toBe(2);
		const b = await answers(chunked);
		expect(a.main.totals.trials).toBe(2 * 3 * per);
		expect(a.main.totals.cutByClear).toBeGreaterThan(0);
		expect(a.replays.total).toBeGreaterThan(0);
		expect(a).toEqual(b);

		// Bytes left behind by the saves, chunked against one document per session.
		const whole = convexTest(schema, modules);
		const big = await play(whole, per);
		console.log(`digest bytes written for ${2 * 3 * per} power-ups: one document per session ${(big.digestBytes / 1e6).toFixed(2)} MB, chunks of 7 ${(small.digestBytes / 1e6).toFixed(2)} MB; replay digests ${(big.replayBytes / 1e6).toFixed(2)} MB against ${(small.replayBytes / 1e6).toFixed(2)} MB`);
		expect(small.digestBytes).toBeLessThan(big.digestBytes / 4);
		expect(small.replayBytes).toBeLessThan(big.replayBytes / 4);
	}, 120_000);
});
