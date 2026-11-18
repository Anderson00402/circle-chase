import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { filterArgs, light, trialRange } from './lib/filters';
import type { Doc } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { unpackSeries } from './lib/series';
import { clipFields, measures, outcome, packedSeries, trialContext } from './validators';
import { bump, bumpCue, cueCounts, trialCounts } from './counters';
import { rescore } from './lib/rules';
import { syncDigest } from './lib/digest';
import { syncReplayDigest } from './lib/replayDigest';

/**
 * Store one finished trial, and its clip when there is one (idempotent by `key`). Context (cue,
 * mode, source, participant, block index) comes from the block and session, not from the caller.
 */
export const save = mutation({
	args: {
		key: v.string(),
		sessionKey: v.string(),
		blockKey: v.string(),
		...trialContext,
		...measures,
		series: packedSeries,
		clip: v.optional(v.object(clipFields))
	},
	handler: async (ctx, { key, sessionKey, blockKey, clip, series, ...sent }) => {
		// The outcome is recomputed from the raw measures with the current rules (convex/lib/rules.ts),
		// so a page running older code cannot store a class the rules would not give.
		const trial = { ...sent, ...rescore(sent) };
		const old = await ctx.db.query('trials').withIndex('by_key', (i) => i.eq('key', key)).unique();
		if (old) return { trialId: old._id, clipId: old.clipId ?? null };
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', sessionKey)).unique();
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', blockKey)).unique();
		if (!s || !b) throw new Error('unknown session or block');
		const now = Date.now();
		const simRun = s.sim?.run;
		const trialId = await ctx.db.insert('trials', {
			...trial, key, participantId: s.participantId, sessionId: s._id, blockId: b._id, cue: b.cue,
			mode: b.mode, source: s.source, blockIndex: b.orderIndex, createdAt: now,
			...(b.practice ? { practice: true } : {}),
			...(simRun ? { simRun } : {})
		});
		await ctx.db.insert('trialSeries', {
			trialId, sessionId: s._id, cue: b.cue, source: s.source, mode: b.mode, createdAt: now, series,
			...(simRun ? { simRun } : {})
		});
		let clipId = null;
		if (clip) {
			clipId = await ctx.db.insert('clips', {
				...clip, trialId, sessionId: s._id, participantId: s.participantId, mode: b.mode, source: s.source,
				outcome: trial.outcome, createdAt: now, size: clip.data.byteLength, ...(b.practice ? { practice: true } : {}),
				numbers: { ...clip.numbers, outcome: trial.outcome }
			});
			await ctx.db.patch(trialId, { clipId });
		}
		const stored = (await ctx.db.get(trialId))!;
		await syncDigest(ctx, stored, series);
		await syncReplayDigest(ctx, stored);
		if (!b.practice) await bump(ctx, s.source, trialCounts({ ...trial, createdAt: now }, !!clip));
		if (!b.practice) await bumpCue(ctx, { source: s.source, cue: b.cue, mode: b.mode }, cueCounts({ ...trial, createdAt: now }));
		await ctx.db.patch(b._id, { trialCount: b.trialCount + 1, engagedCount: b.engagedCount + (trial.engaged ? 1 : 0) });
		await ctx.db.patch(s._id, { trials: s.trials + 1, lastActiveAt: now });
		return { trialId, clipId };
	}
});

/** Trials matching a filter, newest first, paginated. Rows come without their series. */
export const list = query({
	args: {
		...filterArgs,
		outcome: v.optional(outcome),
		engagedOnly: v.optional(v.boolean()),
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, f) => {
		const src = f.source ?? 'human';
		const base = trialRange(ctx, f);
		const page = await base
			.order('desc')
			.filter((q) => q.and(
				src === 'all' ? true : q.eq(q.field('source'), src),
				f.mode ? q.eq(q.field('mode'), f.mode) : true,
				f.cue ? q.eq(q.field('cue'), f.cue) : true,
				f.participantId ? q.eq(q.field('participantId'), f.participantId) : true,
				f.run ? q.eq(q.field('simRun'), f.run) : true,
				f.outcome ? q.eq(q.field('outcome'), f.outcome) : true,
				f.engagedOnly ? q.eq(q.field('engaged'), true) : true,
				f.includePractice ? true : q.neq(q.field('practice'), true)
			))
			.paginate(f.paginationOpts);
		return { ...page, page: page.page.map(light) };
	}
});

/** The packed series of a trial: its `trialSeries` row, or the legacy copy on a row not migrated yet. */
export async function packedSeriesOf(ctx: QueryCtx, t: Doc<'trials'>): Promise<ArrayBuffer | null> {
	const row = await ctx.db.query('trialSeries').withIndex('by_trial', (i) => i.eq('trialId', t._id)).unique();
	return row?.series ?? (t as Doc<'trials'> & { series?: ArrayBuffer }).series ?? null;
}

/** The 10 Hz series of one trial, unpacked into arrays (`{ t, left, dist, chasing, px, py }`); null if missing. */
export const series = query({
	args: { trialId: v.id('trials') },
	handler: async (ctx, { trialId }) => {
		const t = await ctx.db.get(trialId);
		if (!t) return null;
		const packed = await packedSeriesOf(ctx, t);
		return packed ? unpackSeries(packed) : null;
	}
});

/** One trial with its series unpacked into arrays, plus its clip id if it has one. */
export const get = query({
	args: { id: v.id('trials') },
	handler: async (ctx, { id }) => {
		const t = await ctx.db.get(id);
		if (!t) return null;
		const block = await ctx.db.get(t.blockId);
		const participant = await ctx.db.get(t.participantId);
		const packed = await packedSeriesOf(ctx, t);
		return {
			...light(t),
			series: packed ? unpackSeries(packed) : null,
			clipId: t.clipId ?? null,
			participant: participant ? { number: participant.number, nickname: participant.nickname ?? null, id: participant._id, runNumber: participant.runNumber ?? null, source: participant.source } : null,
			block: block ? { key: block.key, cue: block.cue, orderIndex: block.orderIndex, trialCount: block.trialCount } : null
		};
	}
});
