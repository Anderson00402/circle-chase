import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { isDecision } from './lib/rules';
import { mode } from './validators';

type Segment = NonNullable<Doc<'blocks'>['segments']>[number];

/** The block's totals: the sums over the pages that played it. */
function totals(segments: Segment[]) {
	const sum = (k: 'deaths' | 'score' | 'pauses' | 'pausedSeconds') => segments.reduce((n, s) => n + (s[k] ?? 0), 0);
	return {
		deaths: sum('deaths'), score: sum('score'),
		pauses: sum('pauses'), pausedSeconds: Math.round(sum('pausedSeconds') * 10) / 10
	};
}

/**
 * Open a block: one cue played in a session (idempotent by `key`). `segment` names the page that
 * plays it: a page resuming the block after a refresh opens a new segment, which reopens the block.
 */
export const start = mutation({
	args: {
		key: v.string(), sessionKey: v.string(), cue: v.string(), orderIndex: v.number(),
		/** Study warm-up round: its trials are kept but left out of results by default. */
		practice: v.optional(v.boolean()),
		/** Rules of this run when they differ from the session's (the console lets them change between runs). */
		mode: v.optional(mode),
		/** The page playing the block (the telemetry client's instance id). */
		segment: v.optional(v.string())
	},
	handler: async (ctx, a) => {
		const seg = (id: string): Segment => ({ id, open: true, deaths: 0, score: 0 });
		const old = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', a.key)).unique();
		if (old) {
			// A refresh resumed the block: a new page plays on in it, so it is open again. Only one page
			// plays a block at a time, so the earlier pages are over (one that crashed never says so);
			// their totals still count when their last write arrives.
			if (a.segment && !(old.segments ?? []).some((s) => s.id === a.segment)) {
				const earlier = (old.segments ?? []).map((s) => ({ ...s, open: false }));
				await ctx.db.patch(old._id, { segments: [...earlier, seg(a.segment)], endedAt: undefined });
				const s = await ctx.db.get(old.sessionId);
				if (s) await ctx.db.patch(s._id, { lastActiveAt: Date.now(), endedAt: undefined });
			}
			return { blockId: old._id };
		}
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', a.sessionKey)).unique();
		if (!s) throw new Error('unknown session; call sessions:start first');
		const now = Date.now();
		const blockId = await ctx.db.insert('blocks', {
			key: a.key, sessionId: s._id, participantId: s.participantId, cue: a.cue, orderIndex: a.orderIndex,
			mode: a.mode ?? s.mode, source: s.source, startedAt: now, trialCount: 0, engagedCount: 0, deaths: 0, score: 0,
			...(a.practice ? { practice: true } : {}),
			...(a.segment ? { segments: [seg(a.segment)] } : {})
		});
		// A session is open while it has an open block (`endedAt` is set again when a block closes).
		await ctx.db.patch(s._id, { blocks: s.blocks + 1, lastActiveAt: now, endedAt: undefined });
		return { blockId };
	}
});

/**
 * Close a block (or, with `segment`, one page's part of it) with its deaths, score and pauses.
 * A segment's totals may arrive after a later page reopened the block (a closed tab's queue is
 * delivered later): they are added in and the block stays open while the later page plays.
 * Safe to call more than once: the last call of a segment wins. With segments the block's totals
 * are the sums over its pages, whatever order their calls arrive in, and the block ends when no
 * page that opened it is still open. Without `segment` (older callers, the simulator) the call
 * sets the totals itself. The session's `endedAt` becomes the time its latest block closed.
 * Null until the block exists.
 */
export const end = mutation({
	args: {
		key: v.string(), deaths: v.number(), score: v.number(),
		/** How often the game was paused during the block, and for how long in total (s). */
		pauses: v.optional(v.number()), pausedSeconds: v.optional(v.number()),
		/** The page closing its part of the block (as given to `start`). */
		segment: v.optional(v.string())
	},
	handler: async (ctx, a) => {
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', a.key)).unique();
		if (!b) return null;
		const now = Date.now();
		if (a.segment) {
			const mine: Segment = {
				id: a.segment, open: false, deaths: a.deaths, score: a.score,
				...(a.pauses !== undefined ? { pauses: a.pauses } : {}),
				...(a.pausedSeconds !== undefined ? { pausedSeconds: a.pausedSeconds } : {})
			};
			const segments = [...(b.segments ?? []).filter((s) => s.id !== a.segment), mine];
			const stillOpen = segments.some((s) => s.open);
			await ctx.db.patch(b._id, { segments, ...totals(segments), ...(stillOpen ? {} : { endedAt: now }) });
			if (stillOpen) return b._id;
		} else {
			await ctx.db.patch(b._id, {
				endedAt: now, deaths: a.deaths, score: a.score,
				...(a.pauses !== undefined ? { pauses: a.pauses } : {}),
				...(a.pausedSeconds !== undefined ? { pausedSeconds: a.pausedSeconds } : {})
			});
		}
		const s = await ctx.db.get(b.sessionId);
		if (s) {
			const open = (await ctx.db.query('blocks').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect())
				.some((x) => x._id !== b._id && x.endedAt === undefined);
			await ctx.db.patch(s._id, { lastActiveAt: now, ...(open ? {} : { endedAt: now }) });
		}
		return b._id;
	}
});

/**
 * Where a block stands, for a page resuming it after a refresh: how many power-ups are stored,
 * the next free trial index, how many are decision trials, and its totals so far. Null if the
 * block is not stored (yet).
 */
export const progress = query({
	args: { key: v.string() },
	handler: async (ctx, { key }) => {
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', key)).unique();
		if (!b) return null;
		const trials = await ctx.db.query('trials').withIndex('by_block', (i) => i.eq('blockId', b._id)).collect();
		return {
			trials: trials.length,
			nextIndex: trials.reduce((m, t) => Math.max(m, t.trialIndex + 1), 0),
			decisions: trials.filter(isDecision).length,
			deaths: b.deaths, score: b.score, pauses: b.pauses ?? 0, pausedSeconds: b.pausedSeconds ?? 0,
			segments: b.segments?.length ?? 0
		};
	}
});
