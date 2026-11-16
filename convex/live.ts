import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { query } from './_generated/server';
import { STALE_MS } from './presence';
import { sourceFilter } from './validators';

/**
 * Totals for a live header: trials, engaged trials, decision trials, clips, sessions, participants,
 * trials in the last minute and who is playing now. Cheap on purpose: the totals come from the
 * running counters (convex/counters.ts), the last minute from an index range, so a new trial does
 * not make this rescan every trial. Pass `now` (and refresh it every few seconds) if "last minute"
 * must drop back to 0 while nobody plays; otherwise it updates whenever a trial arrives.
 */
export const counters = query({
	args: { source: v.optional(sourceFilter), now: v.optional(v.number()) },
	handler: async (ctx, a) => {
		const src = a.source ?? 'human';
		const now = a.now ?? Date.now();
		const rows = (await ctx.db.query('counters').collect()).filter((c) => src === 'all' || c.source === src);
		const total = (k: 'trials' | 'engaged' | 'inRates' | 'decisions' | 'clips' | 'sessions' | 'participants') => rows.reduce((n, c) => n + c[k], 0);
		const recent: Doc<'trials'>[] = src === 'all'
			? await ctx.db.query('trials').withIndex('by_created', (i) => i.gt('createdAt', now - 60_000)).collect()
			: await ctx.db.query('trials').withIndex('by_source_created', (i) => i.eq('source', src).gt('createdAt', now - 60_000)).collect();
		const last = rows.reduce<number | null>((m, c) => (c.lastTrialAt !== null && (m === null || c.lastTrialAt > m) ? c.lastTrialAt : m), null);
		const presence = (await ctx.db.query('presence').withIndex('by_updated', (i) => i.gt('updatedAt', now - STALE_MS)).collect())
			.filter((p) => src === 'all' || p.source === src);
		return {
			source: src,
			trials: total('trials'),
			engaged: total('engaged'),
			inRates: total('inRates'),
			decisions: total('decisions'),
			clips: total('clips'),
			sessions: total('sessions'),
			participants: total('participants'),
			lastMinute: recent.filter((t) => !t.practice).length,
			lastTrialAt: last,
			nowPlaying: presence.length,
			playing: presence.map((p) => ({ cue: p.cue, mode: p.mode, source: p.source, nickname: p.nickname ?? null, state: p.state, score: p.score, level: p.level, powerLeft: p.powerLeft, startedAt: p.startedAt }))
		};
	}
});
