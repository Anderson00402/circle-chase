/**
 * Full-run recordings on the server: chunks stored once by block key + index (a resend changes
 * nothing), read back in order by range, the index document written from what is stored, and both
 * tables covered by the purges.
 */
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');
const device = { userAgent: 'test', platform: 'test', language: 'en', touch: false, screenW: 1, screenH: 1, dpr: 1 };

async function setup(t: ReturnType<typeof convexTest>, pid: string, source: 'human' | 'bot') {
	await t.mutation(api.participants.ensure, { pid, source, device });
	await t.mutation(api.sessions.start, {
		key: `s-${pid}`, pid, mode: 'study', source, cueOrder: [], appVersion: 'test',
		difficulty: 'normal', sound: true, reducedMotion: false, inputType: 'keyboard', viewport: { w: 1, h: 1, dpr: 1 }
	});
	await t.mutation(api.blocks.start, { key: `b-${pid}`, sessionKey: `s-${pid}`, cue: 'timer-bar', orderIndex: 0 });
	return `b-${pid}`;
}

const chunk = (blockKey: string, i: number, size = 100, fill = 1) => ({
	blockKey, i, base: 0, t0: i * 5, t1: i * 5 + 4.9, at: 1000 + i * 5000, end: 1000 + i * 5000 + 4900, mazeId: 'plaza',
	data: new Uint8Array(size).fill(fill).buffer as ArrayBuffer
});

describe('run recordings', () => {
	test('a chunk is stored once: a resend (even with other bytes) leaves it as it was', async () => {
		const t = convexTest(schema, modules);
		const b = await setup(t, 'p1', 'human');
		expect(await t.mutation(api.runRecordings.saveChunk, { ...chunk(b, 0), source: 'human' })).toEqual({ i: 0, stored: true });
		expect(await t.mutation(api.runRecordings.saveChunk, { ...chunk(b, 0, 300, 9), source: 'human' })).toEqual({ i: 0, stored: false });
		const rows = await t.run((ctx) => ctx.db.query('runChunks').collect());
		expect(rows.length).toBe(1);
		expect(rows[0].data.byteLength).toBe(100);
	});

	test('chunks come back in index order whatever order they arrived in, a range at a time', async () => {
		const t = convexTest(schema, modules);
		const b = await setup(t, 'p1', 'human');
		for (const i of [3, 0, 5, 1, 4, 2]) await t.mutation(api.runRecordings.saveChunk, { ...chunk(b, i), source: 'human' });
		const all = await t.query(api.runRecordings.chunks, { blockKey: b, from: 0, to: 99 });
		expect(all.map((c) => c.i)).toEqual([0, 1, 2, 3, 4, 5]);
		const some = await t.query(api.runRecordings.chunks, { blockKey: b, from: 2, to: 4 });
		expect(some.map((c) => c.i)).toEqual([2, 3]);
		// A refreshed page asks where to carry on.
		expect(await t.query(api.runRecordings.progress, { blockKey: b })).toEqual({ next: 6, runEnd: 29.9 });
		expect(await t.query(api.runRecordings.progress, { blockKey: 'nope' })).toBeNull();
	});

	test('the index document is written from the stored chunks, and kept up to date on a second close', async () => {
		const t = convexTest(schema, modules);
		const b = await setup(t, 'p1', 'human');
		expect(await t.mutation(api.runRecordings.finish, { blockKey: 'not-yet', appVersion: 'x' })).toBeNull();
		for (const i of [0, 1]) await t.mutation(api.runRecordings.saveChunk, { ...chunk(b, i), source: 'human' });
		expect(await t.mutation(api.runRecordings.finish, { blockKey: b, appVersion: 'v1' })).toEqual({ chunks: 2, bytes: 200 });
		await t.mutation(api.runRecordings.saveChunk, { ...chunk(b, 2), source: 'human' });
		await t.mutation(api.runRecordings.finish, { blockKey: b, appVersion: 'v2' });
		const recs = await t.run((ctx) => ctx.db.query('runRecordings').collect());
		expect(recs.length).toBe(1);
		expect(recs[0]).toMatchObject({ chunks: 3, bytes: 300, duration: 14.9, appVersion: 'v2', cue: 'timer-bar', source: 'human' });
		const list = await t.query(api.runRecordings.list, { source: 'human' });
		expect(list.rows.map((r) => r.blockKey)).toEqual([b]);
		const outline = await t.query(api.runRecordings.outline, { key: b });
		expect(outline.found && outline.chunks.map((c) => c.i)).toEqual([0, 1, 2]);
	});

	test('deleting simulated data removes their recordings only; wiping removes all', async () => {
		const t = convexTest(schema, modules);
		const h = await setup(t, 'p1', 'human');
		const s = await setup(t, 'bot-1', 'bot');
		for (const i of [0, 1]) {
			await t.mutation(api.runRecordings.saveChunk, { ...chunk(h, i), source: 'human' });
			await t.mutation(api.runRecordings.saveChunk, { ...chunk(s, i), source: 'bot' });
		}
		await t.mutation(api.runRecordings.finish, { blockKey: h, appVersion: 'x' });
		await t.mutation(api.runRecordings.finish, { blockKey: s, appVersion: 'x' });
		await t.mutation(api.admin.deleteBotData, { confirm: 'delete bot data' });
		const left = await t.run(async (ctx) => ({ chunks: await ctx.db.query('runChunks').collect(), recs: await ctx.db.query('runRecordings').collect() }));
		expect(left.chunks.every((c) => c.blockKey === h)).toBe(true);
		expect(left.chunks.length).toBe(2);
		expect(left.recs.map((r) => r.blockKey)).toEqual([h]);
		await t.mutation(api.admin.wipeEverything, { confirm: 'wipe everything' });
		expect(await t.run((ctx) => ctx.db.query('runChunks').collect())).toEqual([]);
		expect(await t.run((ctx) => ctx.db.query('runRecordings').collect())).toEqual([]);
	});
});
