import { v } from 'convex/values';
import { mutation } from './_generated/server';

const scale = (n: number, what: string) => {
	if (!Number.isInteger(n) || n < 1 || n > 7) throw new Error(`${what} must be a whole number from 1 to 7`);
};

/** After a block: clarity and distraction, 1-7 (idempotent by `key`; a second save updates). */
export const saveBlock = mutation({
	args: { key: v.string(), blockKey: v.string(), clarity: v.number(), distraction: v.number() },
	handler: async (ctx, a) => {
		scale(a.clarity, 'clarity');
		scale(a.distraction, 'distraction');
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', a.blockKey)).unique();
		if (!b) throw new Error('unknown block');
		const old = await ctx.db.query('ratings').withIndex('by_key', (i) => i.eq('key', a.key)).unique();
		if (old) { await ctx.db.patch(old._id, { clarity: a.clarity, distraction: a.distraction }); return old._id; }
		return ctx.db.insert('ratings', {
			key: a.key, kind: 'block', sessionId: b.sessionId, participantId: b.participantId, blockId: b._id, cue: b.cue,
			clarity: a.clarity, distraction: a.distraction, mode: b.mode, source: b.source, createdAt: Date.now()
		});
	}
});

/** End of a session: the clearest and least clear cue, and a free comment. */
export const saveSession = mutation({
	args: {
		key: v.string(), sessionKey: v.string(), clearest: v.optional(v.string()), leastClear: v.optional(v.string()),
		comment: v.optional(v.string())
	},
	handler: async (ctx, a) => {
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', a.sessionKey)).unique();
		if (!s) throw new Error('unknown session');
		const fields = {
			...(a.clearest ? { clearest: a.clearest } : {}),
			...(a.leastClear ? { leastClear: a.leastClear } : {}),
			...(a.comment ? { comment: a.comment.slice(0, 2000) } : {})
		};
		const old = await ctx.db.query('ratings').withIndex('by_key', (i) => i.eq('key', a.key)).unique();
		if (old) { await ctx.db.patch(old._id, fields); return old._id; }
		return ctx.db.insert('ratings', {
			key: a.key, kind: 'session', sessionId: s._id, participantId: s.participantId, mode: s.mode, source: s.source,
			createdAt: Date.now(), ...fields
		});
	}
});
