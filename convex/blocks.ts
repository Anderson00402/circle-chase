import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { mode } from './validators';

/** Open a block: one cue played in a session (idempotent by `key`). */
export const start = mutation({
	args: {
		key: v.string(), sessionKey: v.string(), cue: v.string(), orderIndex: v.number(),
		/** Study warm-up round: its trials are kept but left out of results by default. */
		practice: v.optional(v.boolean()),
		/** Rules of this run when they differ from the session's (the console lets them change between runs). */
		mode: v.optional(mode)
	},
	handler: async (ctx, a) => {
		const old = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', a.key)).unique();
		if (old) return { blockId: old._id };
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', a.sessionKey)).unique();
		if (!s) throw new Error('unknown session; call sessions:start first');
		const now = Date.now();
		const blockId = await ctx.db.insert('blocks', {
			key: a.key, sessionId: s._id, participantId: s.participantId, cue: a.cue, orderIndex: a.orderIndex,
			mode: a.mode ?? s.mode, source: s.source, startedAt: now, trialCount: 0, engagedCount: 0, deaths: 0, score: 0,
			...(a.practice ? { practice: true } : {})
		});
		// A session is open while it has an open block (`endedAt` is set again when a block closes).
		await ctx.db.patch(s._id, { blocks: s.blocks + 1, lastActiveAt: now, endedAt: undefined });
		return { blockId };
	}
});

/**
 * Close a block with its deaths, score and pauses (safe to call more than once; the last call
 * wins). The session's `endedAt` becomes the time its latest block closed, so a session ends with
 * its last block (End run, switching case, or the page closing). Null until the block exists.
 */
export const end = mutation({
	args: {
		key: v.string(), deaths: v.number(), score: v.number(),
		/** How often the game was paused during the block, and for how long in total (s). */
		pauses: v.optional(v.number()), pausedSeconds: v.optional(v.number())
	},
	handler: async (ctx, a) => {
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', a.key)).unique();
		if (!b) return null;
		const now = Date.now();
		await ctx.db.patch(b._id, {
			endedAt: now, deaths: a.deaths, score: a.score,
			...(a.pauses !== undefined ? { pauses: a.pauses } : {}),
			...(a.pausedSeconds !== undefined ? { pausedSeconds: a.pausedSeconds } : {})
		});
		const s = await ctx.db.get(b.sessionId);
		if (s) {
			const open = (await ctx.db.query('blocks').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect())
				.some((x) => x._id !== b._id && x.endedAt === undefined);
			await ctx.db.patch(s._id, { lastActiveAt: now, ...(open ? {} : { endedAt: now }) });
		}
		return b._id;
	}
});
