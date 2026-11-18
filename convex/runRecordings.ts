/**
 * Full-run recordings (src/lib/telemetry/runrec.ts): every run (block) kept from start to end.
 *
 * - `runChunks`: one document per ~5 s of game time, written once by `saveChunk` and never
 *   rewritten (idempotent by block key + chunk index). About 1-1.5 KB each.
 * - `runRecordings`: one small index document per run, written by `finish` when the block closes
 *   (a run resumed after a refresh closes once per page; the same document is brought up to date).
 *   Lists read these, never the chunks.
 *
 * The chunks do not wait for the block: they carry their own `source` (for the purge) and are
 * written in their own outbox lane, so they never hold up or reorder the trial writes.
 */
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { participantName } from './lib/replayDigest';
import { mode, source, sourceFilter } from './validators';

/** What a page sends for one chunk (src/lib/telemetry/runrec.ts `RunChunk`). */
export const chunkFields = {
	blockKey: v.string(),
	i: v.number(),
	base: v.number(),
	t0: v.number(),
	t1: v.number(),
	at: v.number(),
	end: v.number(),
	mazeId: v.string(),
	layout: v.optional(v.string()),
	trials: v.optional(v.array(v.string())),
	data: v.bytes()
};

export const runChunkFields = { ...chunkFields, source };

export const runRecordingFields = {
	blockKey: v.string(),
	sessionId: v.id('sessions'),
	participantId: v.id('participants'),
	/** The participant as shown everywhere (`participantName`), so lists never read the participants. */
	label: v.string(),
	cue: v.string(),
	mode,
	source,
	practice: v.optional(v.boolean()),
	orderIndex: v.number(),
	/** Run time covered (s), chunks stored and their packed bytes, at the last close. */
	duration: v.number(),
	chunks: v.number(),
	bytes: v.number(),
	appVersion: v.string(),
	/** Wall-clock times (ms) of the first and last chunk. */
	startedAt: v.number(),
	endedAt: v.number(),
	updatedAt: v.number()
};

/** Store one chunk (idempotent: a chunk already stored is left as it is). */
export const saveChunk = mutation({
	args: { ...chunkFields, source },
	handler: async (ctx, c) => {
		const old = await ctx.db.query('runChunks').withIndex('by_block', (i) => i.eq('blockKey', c.blockKey).eq('i', c.i)).first();
		if (old) return { i: c.i, stored: false };
		await ctx.db.insert('runChunks', c);
		return { i: c.i, stored: true };
	}
});

/**
 * Write (or bring up to date) the run's index document from its stored chunks. Answers null while
 * the block is not there yet (the outbox tries again).
 */
export const finish = mutation({
	args: { blockKey: v.string(), appVersion: v.string() },
	handler: async (ctx, { blockKey, appVersion }) => {
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', blockKey)).unique();
		if (!b) return null;
		const chunks = await ctx.db.query('runChunks').withIndex('by_block', (i) => i.eq('blockKey', blockKey)).collect();
		if (!chunks.length) return { chunks: 0 };
		const s = await ctx.db.get(b.sessionId);
		const p = await ctx.db.get(b.participantId);
		const label = participantName({ label: s?.run?.participantLabel, nickname: p?.nickname, runNumber: p?.runNumber, number: p?.number, source: b.source });
		const doc = {
			blockKey, sessionId: b.sessionId, participantId: b.participantId, label, cue: b.cue, mode: b.mode, source: b.source,
			...(b.practice ? { practice: true } : {}), orderIndex: b.orderIndex,
			duration: +(chunks[chunks.length - 1].t1 - chunks[0].t0).toFixed(2),
			chunks: chunks.length, bytes: chunks.reduce((a, c) => a + c.data.byteLength, 0), appVersion,
			startedAt: chunks[0].at, endedAt: Math.max(...chunks.map((c) => c.end)), updatedAt: Date.now()
		};
		const old = await ctx.db.query('runRecordings').withIndex('by_block', (i) => i.eq('blockKey', blockKey)).unique();
		if (old) await ctx.db.patch(old._id, doc);
		else await ctx.db.insert('runRecordings', doc);
		return { chunks: doc.chunks, bytes: doc.bytes };
	}
});

/** Where a refreshed page carries on: the next chunk index and the run time reached. Null before the first chunk. */
export const progress = query({
	args: { blockKey: v.string() },
	handler: async (ctx, { blockKey }) => {
		const last = await ctx.db.query('runChunks').withIndex('by_block', (i) => i.eq('blockKey', blockKey)).order('desc').first();
		return last ? { next: last.i + 1, runEnd: last.t1 } : null;
	}
});

/** The block a key names: a block key, or the id of one of its trials. */
async function blockOf(ctx: QueryCtx, key: string): Promise<{ block: Doc<'blocks'> | null; trialId: Id<'trials'> | null }> {
	const tid = ctx.db.normalizeId('trials', key);
	if (tid) {
		const t = await ctx.db.get(tid);
		return { block: t ? await ctx.db.get(t.blockId) : null, trialId: tid };
	}
	return { block: await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', key)).unique(), trialId: null };
}

/**
 * Everything the full-run player needs except the packed scenes: the run, its chunks' time spans
 * (without their bytes), and its trials with what the timeline shows. `key` is a block key or the
 * id of one of its trials (a link from a replay card). Live: a run being played grows.
 */
export const outline = query({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		const { block: b, trialId } = await blockOf(ctx, key);
		if (!b) return { found: false as const, trialId };
		const chunks = await ctx.db.query('runChunks').withIndex('by_block', (i) => i.eq('blockKey', b.key)).collect();
		const trials = (await ctx.db.query('trials').withIndex('by_block', (i) => i.eq('blockId', b._id)).collect())
			.sort((x, y) => x._creationTime - y._creationTime);
		const rec = await ctx.db.query('runRecordings').withIndex('by_block', (i) => i.eq('blockKey', b.key)).unique();
		const s = await ctx.db.get(b.sessionId);
		const p = await ctx.db.get(b.participantId);
		return {
			found: true as const, trialId,
			block: {
				key: b.key, cue: b.cue, mode: b.mode, source: b.source, orderIndex: b.orderIndex, startedAt: b.startedAt, endedAt: b.endedAt ?? null,
				practice: !!b.practice, participantId: b.participantId, deaths: b.deaths, score: b.score,
				label: participantName({ label: s?.run?.participantLabel, nickname: p?.nickname, runNumber: p?.runNumber, number: p?.number, source: b.source })
			},
			recording: rec ? { chunks: rec.chunks, bytes: rec.bytes, duration: rec.duration, appVersion: rec.appVersion } : null,
			chunks: chunks.map((c) => ({
				i: c.i, base: c.base, t0: c.t0, t1: c.t1, at: c.at, end: c.end, mazeId: c.mazeId, layout: c.layout ?? null,
				trials: c.trials ?? [], bytes: c.data.byteLength
			})),
			trials: trials.map((t, n) => ({
				_id: t._id, key: t.key, n: n + 1, trialIndex: t.trialIndex, createdAt: t.createdAt, outcome: t.outcome, engaged: t.engaged,
				startedAt: t.startedAt, endedAt: t.endedAt, total: t.total, endReason: t.endReason, leftAtEnd: t.leftAtEnd,
				turnAt: t.turnAt, turnLeft: t.turnLeft, turnDist: t.turnDist, endDist: t.endDist, lastChaseEnd: t.lastChaseEnd ?? null,
				eats: t.eats.map((e) => ({ t: e.t, ghost: e.ghost, left: e.left })),
				after: { died: t.after.died, caught: t.after.caught, timeToCaught: t.after.timeToCaught, seen: t.after.seen, killer: t.after.killer },
				diedDuring: t.diedDuring, clipId: t.clipId ?? null
			}))
		};
	}
});

/** At most this many chunks per read (about a minute of play, 15-20 KB). */
export const CHUNK_PAGE = 12;

/** Chunks `from` to `to - 1` of a run with their bytes, in order (one indexed range read). */
export const chunks = query({
	args: { blockKey: v.string(), from: v.number(), to: v.number() },
	handler: async (ctx, { blockKey, from, to }) => {
		const rows = await ctx.db.query('runChunks')
			.withIndex('by_block', (i) => i.eq('blockKey', blockKey).gte('i', from).lt('i', Math.min(to, from + CHUNK_PAGE)))
			.collect();
		return rows.map(({ _id, _creationTime, source: _s, ...c }) => c);
	}
});

/** Whole runs for the replay browser, newest first: by source, participant and case. */
export const list = query({
	args: { source: v.optional(sourceFilter), participant: v.optional(v.string()), cue: v.optional(v.string()), limit: v.optional(v.number()) },
	handler: async (ctx, a) => {
		const src = a.source ?? 'human';
		const read = (s: 'human' | 'bot') => ctx.db.query('runRecordings').withIndex('by_source', (i) => i.eq('source', s)).order('desc').take(1000);
		const all = src === 'all' ? [...(await read('human')), ...(await read('bot'))].sort((x, y) => y.startedAt - x.startedAt) : await read(src);
		const shown = all.filter((r) => !r.practice);
		const people = new Map<string, { id: Id<'participants'>; label: string; source: 'human' | 'bot' }>();
		for (const r of shown) if (!people.has(r.participantId)) people.set(r.participantId, { id: r.participantId, label: r.label, source: r.source });
		const hits = shown.filter((r) => (!a.participant || r.participantId === a.participant) && (!a.cue || r.cue === a.cue));
		return {
			rows: hits.slice(0, Math.max(1, Math.min(a.limit ?? 48, 500))).map(({ _id, _creationTime, sessionId: _s, ...r }) => r),
			total: hits.length,
			participants: [...people.values()].sort((x, y) => x.source.localeCompare(y.source) || x.label.localeCompare(y.label, undefined, { numeric: true }))
		};
	}
});

/** Every chunk of one run with its bytes, for the JSON export (convex/http.ts). */
export const allChunks = query({
	args: { blockKey: v.string(), from: v.number() },
	handler: async (ctx, { blockKey, from }) => {
		const rows = await ctx.db.query('runChunks').withIndex('by_block', (i) => i.eq('blockKey', blockKey).gte('i', from)).take(60);
		return rows.map(({ _id, _creationTime, ...c }) => c);
	}
});
