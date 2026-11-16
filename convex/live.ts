import { v } from 'convex/values';
import { query } from './_generated/server';
import { STALE_MS } from './presence';
import { sourceFilter } from './validators';

/**
 * Totals for a live header: trials, engaged trials, clips, sessions, participants, trials in the
 * last minute and who is playing now. Pass `now` (and refresh it every few seconds) if "last
 * minute" must drop back to 0 while nobody plays; otherwise it updates whenever a trial arrives.
 */
export const counters = query({
	args: { source: v.optional(sourceFilter), now: v.optional(v.number()) },
	handler: async (ctx, a) => {
		const src = a.source ?? 'human';
		const now = a.now ?? Date.now();
		const trials = (src === 'all'
			? await ctx.db.query('trials').withIndex('by_created').collect()
			: await ctx.db.query('trials').withIndex('by_source_created', (i) => i.eq('source', src)).collect()
		).filter((t) => !t.practice);
		const sessions = src === 'all'
			? await ctx.db.query('sessions').collect()
			: await ctx.db.query('sessions').withIndex('by_source_started', (i) => i.eq('source', src)).collect();
		const presence = (await ctx.db.query('presence').withIndex('by_updated', (i) => i.gt('updatedAt', now - STALE_MS)).collect())
			.filter((p) => src === 'all' || p.source === src);
		return {
			source: src,
			trials: trials.length,
			engaged: trials.filter((t) => t.engaged).length,
			inRates: trials.filter((t) => t.inRates).length,
			clips: trials.filter((t) => t.clipId).length,
			sessions: sessions.length,
			participants: new Set(sessions.map((s) => s.participantId)).size,
			lastMinute: trials.filter((t) => t.createdAt > now - 60_000).length,
			lastTrialAt: trials.length ? trials[trials.length - 1].createdAt : null,
			nowPlaying: presence.length,
			playing: presence.map((p) => ({ cue: p.cue, mode: p.mode, source: p.source, nickname: p.nickname ?? null, state: p.state, score: p.score, level: p.level, powerLeft: p.powerLeft, startedAt: p.startedAt }))
		};
	}
});
