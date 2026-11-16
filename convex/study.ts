/**
 * The guided study (`/study`): what the session was set up with, notes on each block, and the
 * results a participant sees at the end. Blocks and trials themselves are written by the normal
 * telemetry functions (sessions.start, blocks.start with `practice`, trials.save).
 */
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/** Stored on the session: how the study was set up. */
export const studyInfo = v.object({
	/** quick: 5 conditions (always "No signal" and the timer bar). full: all of them. */
	length: v.union(v.literal('quick'), v.literal('full')),
	/** Answer to the sound check: heard the test tone, did not hear it, or chose to play muted. */
	soundCheck: v.union(v.literal('heard'), v.literal('not-heard'), v.literal('muted')),
	/** Participant number the order was picked with, and the row of the counterbalancing table. */
	participantNumber: v.number(),
	orderRow: v.number(),
	/** 'server' when the number came from participants.ensure; 'local' when Convex was unreachable and a random one was used. */
	numberFrom: v.union(v.literal('server'), v.literal('local')),
	/** Server ms when the participant reached the end screen. */
	finishedAt: v.optional(v.number())
});

/** Record how the session was set up (idempotent). Returns null while the session does not exist yet, so the caller retries. */
export const setup = mutation({
	args: { sessionKey: v.string(), study: studyInfo },
	handler: async (ctx, { sessionKey, study }) => {
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', sessionKey)).unique();
		if (!s) return null;
		await ctx.db.patch(s._id, { study: { ...s.study, ...study } });
		return s._id;
	}
});

/** Mark the end screen reached. */
export const finish = mutation({
	args: { sessionKey: v.string() },
	handler: async (ctx, { sessionKey }) => {
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', sessionKey)).unique();
		if (!s) return null;
		const now = Date.now();
		await ctx.db.patch(s._id, { endedAt: s.endedAt ?? now, ...(s.study ? { study: { ...s.study, finishedAt: now } } : {}) });
		return s._id;
	}
});

/** Pauses during a block, or that it was left unfinished and played again. Null while the block does not exist yet. */
export const markBlock = mutation({
	args: {
		blockKey: v.string(), pauses: v.optional(v.number()), pausedSeconds: v.optional(v.number()),
		abandoned: v.optional(v.boolean())
	},
	handler: async (ctx, { blockKey, ...rest }) => {
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', blockKey)).unique();
		if (!b) return null;
		const patch: Record<string, number | boolean> = {};
		for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
		await ctx.db.patch(b._id, patch);
		return b._id;
	}
});

/**
 * One participant's own results, per round, for the thank-you screen: trials, how many counted,
 * well timed (late catch + timely retreat) and caught, both out of the trials that count toward
 * the rates (as on the dashboard). Null until the session exists.
 */
export const results = query({
	args: { sessionKey: v.string() },
	handler: async (ctx, { sessionKey }) => {
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', sessionKey)).unique();
		if (!s) return null;
		const blocks = await ctx.db.query('blocks').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
		const trials = await ctx.db.query('trials').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
		const ratings = await ctx.db.query('ratings').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
		return {
			sessionId: s._id,
			cueOrder: s.cueOrder,
			source: s.source,
			blocks: blocks.map((b) => {
				const ts = trials.filter((t) => t.blockId === b._id);
				const counted = ts.filter((t) => t.inRates);
				const r = ratings.find((x) => x.blockId === b._id);
				return {
					key: b.key, cue: b.cue, orderIndex: b.orderIndex, practice: b.practice ?? false, abandoned: b.abandoned ?? false,
					trials: ts.length, engaged: ts.filter((t) => t.engaged).length, counted: counted.length,
					wellTimed: counted.filter((t) => t.outcome === 'late-catch' || t.outcome === 'timely-retreat').length,
					caught: counted.filter((t) => t.outcome === 'caught').length,
					clips: ts.filter((t) => t.clipId).length,
					firstTrialId: ts.find((t) => t.clipId)?._id ?? null,
					deaths: b.deaths, score: b.score, pauses: b.pauses ?? 0,
					clarity: r?.clarity ?? null, distraction: r?.distraction ?? null, note: r?.note ?? null
				};
			}),
			session: ratings.find((x) => x.kind === 'session') ?? null
		};
	}
});
