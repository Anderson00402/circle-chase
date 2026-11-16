import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query } from './_generated/server';
import { mode, sourceFilter } from './validators';

/** Most moments the list reads at once (trial rows are about 2 KB, so this stays well within limits). */
const LIMIT = 4000;

/**
 * Every trial that has a replay clip, newest first, as light rows for the replay browser: context,
 * outcome and the headline numbers, plus the participant's number. Sorting and the cue, outcome
 * and participant filters happen in the browser, so one subscription serves every view and updates
 * live as clips arrive. Reads trials (about 2 KB each), never the clips themselves (10-15 KB).
 * `has` says whether any human or simulated clips exist at all, for the empty states.
 */
export const list = query({
	args: { source: v.optional(sourceFilter), mode: v.optional(mode) },
	handler: async (ctx, a) => {
		const src = a.source ?? 'human';
		const q = ctx.db.query('trials');
		const all = src === 'all'
			? await q.withIndex('by_created').order('desc').take(LIMIT)
			: await q.withIndex('by_source_created', (i) => i.eq('source', src)).order('desc').take(LIMIT);
		// Warm-up (practice) trials are not part of the study and stay out, like everywhere else.
		const trials = all.filter((t) => t.clipId && !t.practice && (!a.mode || t.mode === a.mode));

		const people = new Map<Id<'participants'>, Doc<'participants'> | null>();
		for (const t of trials) if (!people.has(t.participantId)) people.set(t.participantId, await ctx.db.get(t.participantId));

		const rows = trials.map((t) => {
			const p = people.get(t.participantId);
			const last = t.eats.length ? t.eats[t.eats.length - 1] : null;
			return {
				trialId: t._id,
				clipId: t.clipId!,
				cue: t.cue,
				outcome: t.outcome,
				source: t.source,
				mode: t.mode,
				createdAt: t.createdAt,
				participant: p ? p.number : null,
				nickname: p?.nickname ?? null,
				blockIndex: t.blockIndex,
				trialIndex: t.trialIndex,
				startedAt: t.startedAt,
				endedAt: t.endedAt,
				total: t.total,
				turnAt: t.turnAt,
				turnLeft: t.turnLeft,
				turnDist: t.turnDist,
				endDist: t.endDist,
				eats: t.eats.length,
				lastEatAt: last ? t.startedAt + last.t : null,
				lastEatLeft: last ? last.left : null,
				caught: t.after.caught,
				died: t.after.died,
				timeToCaught: t.after.timeToCaught,
				nearMiss: t.after.nearMiss,
				engaged: t.engaged,
				inRates: t.inRates
			};
		});
		const has = {
			human: (await ctx.db.query('clips').withIndex('by_source_created', (i) => i.eq('source', 'human')).first()) !== null,
			bot: (await ctx.db.query('clips').withIndex('by_source_created', (i) => i.eq('source', 'bot')).first()) !== null
		};
		return { rows, has, truncated: all.length === LIMIT };
	}
});
