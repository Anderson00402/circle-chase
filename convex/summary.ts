import { query } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { filterArgs, scanTrials, type Filter } from './lib/filters';
import { summarize, type CueSummary } from './lib/stats';
import type { QueryCtx } from './_generated/server';

async function blockRatings(ctx: QueryCtx, f: Filter): Promise<Doc<'ratings'>[]> {
	const src = f.source ?? 'human';
	const rows = f.cue
		? await ctx.db.query('ratings').withIndex('by_cue', (i) => i.eq('cue', f.cue!)).collect()
		: await ctx.db.query('ratings').collect();
	return rows.filter((r) => r.kind === 'block'
		&& (src === 'all' || r.source === src)
		&& (!f.mode || r.mode === f.mode)
		&& (!f.participantId || r.participantId === f.participantId)
		&& (!f.sessionId || r.sessionId === f.sessionId)
		&& r.createdAt >= (f.from ?? 0) && r.createdAt <= (f.to ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Headline numbers per cue for a filter (STUDY.md "Headline numbers per cue"), plus the same over
 * all cues. Reads every trial of the filter in one go.
 */
export const byCue = query({
	args: filterArgs,
	handler: async (ctx, f): Promise<{ source: string; cues: CueSummary[]; all: CueSummary; scanned: number }> => {
		const trials = await scanTrials(ctx, f);
		const ratings = await blockRatings(ctx, f);
		const cues = [...new Set([...trials.map((t) => t.cue), ...ratings.map((r) => r.cue ?? '')].filter(Boolean))].sort();
		return {
			source: f.source ?? 'human',
			cues: cues.map((c) => summarize(c, trials.filter((t) => t.cue === c), ratings.filter((r) => r.cue === c))),
			all: summarize('all', trials, ratings),
			scanned: trials.length
		};
	}
});
