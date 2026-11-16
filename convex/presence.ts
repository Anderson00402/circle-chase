import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { mode, source } from './validators';

/** Rows older than this are not "now playing" and are removed by the cron. */
export const STALE_MS = 20_000;

/** Called every few seconds while a game page is open. */
export const heartbeat = mutation({
	args: {
		sessionKey: v.string(), pid: v.string(), nickname: v.optional(v.string()), cue: v.string(), mode, source,
		state: v.union(v.literal('playing'), v.literal('idle')), score: v.number(), level: v.number(), powerLeft: v.number()
	},
	handler: async (ctx, a) => {
		const now = Date.now();
		const old = await ctx.db.query('presence').withIndex('by_session', (i) => i.eq('sessionKey', a.sessionKey)).unique();
		if (old) {
			// Skip the write when nothing a viewer would see changed and the row is still fresh.
			const same = old.cue === a.cue && old.state === a.state && old.score === a.score && old.level === a.level
				&& (old.powerLeft > 0) === (a.powerLeft > 0) && now - old.updatedAt < STALE_MS / 2;
			if (!same) await ctx.db.patch(old._id, { ...a, updatedAt: now, startedAt: old.cue === a.cue ? old.startedAt : now });
			return old._id;
		}
		return ctx.db.insert('presence', { ...a, startedAt: now, updatedAt: now });
	}
});

/** The page is closing. */
export const leave = mutation({
	args: { sessionKey: v.string() },
	handler: async (ctx, { sessionKey }) => {
		const old = await ctx.db.query('presence').withIndex('by_session', (i) => i.eq('sessionKey', sessionKey)).unique();
		if (old) await ctx.db.delete(old._id);
	}
});

/** Who is playing right now, most recent first. */
export const nowPlaying = query({
	args: {},
	handler: async (ctx) => {
		const since = Date.now() - STALE_MS;
		const rows = await ctx.db.query('presence').withIndex('by_updated', (i) => i.gt('updatedAt', since)).order('desc').collect();
		return rows.map(({ pid: _pid, ...r }) => r);
	}
});

/** Cron: drop rows whose page stopped sending heartbeats. */
export const sweep = internalMutation({
	args: {},
	handler: async (ctx) => {
		const old = await ctx.db.query('presence').withIndex('by_updated', (i) => i.lt('updatedAt', Date.now() - STALE_MS)).take(200);
		for (const r of old) await ctx.db.delete(r._id);
		return old.length;
	}
});
