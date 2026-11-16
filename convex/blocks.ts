import { v } from 'convex/values';
import { mutation } from './_generated/server';

/** Open a block: one cue played in a session (idempotent by `key`). */
export const start = mutation({
	args: {
		key: v.string(), sessionKey: v.string(), cue: v.string(), orderIndex: v.number(),
		/** Study warm-up round: its trials are kept but left out of results by default. */
		practice: v.optional(v.boolean())
	},
	handler: async (ctx, a) => {
		const old = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', a.key)).unique();
		if (old) return { blockId: old._id };
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', a.sessionKey)).unique();
		if (!s) throw new Error('unknown session; call sessions:start first');
		const now = Date.now();
		const blockId = await ctx.db.insert('blocks', {
			key: a.key, sessionId: s._id, participantId: s.participantId, cue: a.cue, orderIndex: a.orderIndex,
			mode: s.mode, source: s.source, startedAt: now, trialCount: 0, engagedCount: 0, deaths: 0, score: 0,
			...(a.practice ? { practice: true } : {})
		});
		await ctx.db.patch(s._id, { blocks: s.blocks + 1, lastActiveAt: now });
		return { blockId };
	}
});

/** Close a block with its deaths and score (safe to call more than once; the last call wins). */
export const end = mutation({
	args: { key: v.string(), deaths: v.number(), score: v.number() },
	handler: async (ctx, a) => {
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', a.key)).unique();
		if (!b) return null;
		await ctx.db.patch(b._id, { endedAt: Date.now(), deaths: a.deaths, score: a.score });
		return b._id;
	}
});
