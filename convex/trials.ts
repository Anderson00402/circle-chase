import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { filterArgs, light } from './lib/filters';
import { unpackSeries } from './lib/series';
import { clipFields, measures, outcome, trialContext } from './validators';
import { bump, trialCounts } from './counters';
import { rescore } from './lib/rules';

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
		clip: v.optional(v.object(clipFields))
	},
	handler: async (ctx, { key, sessionKey, blockKey, clip, ...sent }) => {
		// The outcome is recomputed from the raw measures with the current rules (convex/lib/rules.ts),
		// so a page running older code cannot store a class the rules would not give.
		const trial = { ...sent, ...rescore(sent) };
		const old = await ctx.db.query('trials').withIndex('by_key', (i) => i.eq('key', key)).unique();
		if (old) return { trialId: old._id, clipId: old.clipId ?? null };
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', sessionKey)).unique();
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', blockKey)).unique();
		if (!s || !b) throw new Error('unknown session or block');
		const now = Date.now();
		const trialId = await ctx.db.insert('trials', {
			...trial, key, participantId: s.participantId, sessionId: s._id, blockId: b._id, cue: b.cue,
			mode: s.mode, source: s.source, blockIndex: b.orderIndex, createdAt: now,
			...(b.practice ? { practice: true } : {})
		});
		let clipId = null;
		if (clip) {
			clipId = await ctx.db.insert('clips', {
				...clip, trialId, sessionId: s._id, participantId: s.participantId, mode: s.mode, source: s.source,
				outcome: trial.outcome, createdAt: now, size: clip.data.byteLength, ...(b.practice ? { practice: true } : {}),
				numbers: { ...clip.numbers, outcome: trial.outcome }
			});
			await ctx.db.patch(trialId, { clipId });
		}
		if (!b.practice) await bump(ctx, s.source, trialCounts({ ...trial, createdAt: now }, !!clip));
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
		const from = f.from ?? 0, to = f.to ?? Number.MAX_SAFE_INTEGER;
		const t = ctx.db.query('trials');
		const base = f.sessionId
			? t.withIndex('by_session', (i) => i.eq('sessionId', f.sessionId!).gte('createdAt', from).lte('createdAt', to))
			: f.participantId
				? t.withIndex('by_participant', (i) => i.eq('participantId', f.participantId!).gte('createdAt', from).lte('createdAt', to))
				: src !== 'all' && f.cue
					? t.withIndex('by_source_cue', (i) => i.eq('source', src).eq('cue', f.cue!).gte('createdAt', from).lte('createdAt', to))
					: src !== 'all'
						? t.withIndex('by_source_created', (i) => i.eq('source', src).gte('createdAt', from).lte('createdAt', to))
						: f.cue
							? t.withIndex('by_cue_created', (i) => i.eq('cue', f.cue!).gte('createdAt', from).lte('createdAt', to))
							: t.withIndex('by_created', (i) => i.gte('createdAt', from).lte('createdAt', to));
		const page = await base
			.order('desc')
			.filter((q) => q.and(
				src === 'all' ? true : q.eq(q.field('source'), src),
				f.mode ? q.eq(q.field('mode'), f.mode) : true,
				f.cue ? q.eq(q.field('cue'), f.cue) : true,
				f.outcome ? q.eq(q.field('outcome'), f.outcome) : true,
				f.engagedOnly ? q.eq(q.field('engaged'), true) : true,
				f.includePractice ? true : q.neq(q.field('practice'), true)
			))
			.paginate(f.paginationOpts);
		return { ...page, page: page.page.map(light) };
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
		return {
			...light(t),
			series: unpackSeries(t.series),
			clipId: t.clipId ?? null,
			participant: participant ? { number: participant.number, nickname: participant.nickname ?? null } : null,
			block: block ? { cue: block.cue, orderIndex: block.orderIndex, trialCount: block.trialCount } : null
		};
	}
});
