import { v } from 'convex/values';
import { query } from './_generated/server';
import { mode, sourceFilter } from './validators';
import { ENOUGH, wilson } from './lib/stats';
import type { Doc } from './_generated/dataModel';
import { filterArgs, scanTrials, type Filter } from './lib/filters';
import { summarize, type CueSummary } from './lib/stats';
import type { QueryCtx } from './_generated/server';

/** Block ratings (clarity, distraction) matching a filter. Also used by dashboard.ts. */
export async function blockRatings(ctx: QueryCtx, f: Filter): Promise<Doc<'ratings'>[]> {
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
	handler: async (ctx, f): Promise<{ source: string; cues: CueSummary[]; all: CueSummary; scanned: number; leftOut: { oldRules: number } }> => {
		const trials = await scanTrials(ctx, f);
		const ratings = await blockRatings(ctx, f);
		const cues = [...new Set([...trials.map((t) => t.cue), ...ratings.map((r) => r.cue ?? '')].filter(Boolean))].sort();
		const all = summarize('all', trials, ratings);
		return {
			source: f.source ?? 'human',
			cues: cues.map((c) => summarize(c, trials.filter((t) => t.cue === c), ratings.filter((r) => r.cue === c))),
			all,
			scanned: trials.length,
			/** Eligible trials left out of every rate because they were recorded before the current rules. */
			leftOut: all.leftOut
		};
	}
});

/**
 * What is stored for one case, for the play page's live panel: trials, decision trials, and the
 * share caught and turned away in time (Wilson intervals). Reads the running totals in
 * `cueCounters` (one small document per source, case and rules), never trial rows, so it stays
 * instant however much is stored and does not rerun a scan after every new trial.
 */
export const cueCounts = query({
	args: { source: v.optional(sourceFilter), cue: v.string(), mode: v.optional(mode) },
	handler: async (ctx, { source: src = 'human', cue, mode: m }) => {
		const sources = src === 'all' ? (['human', 'bot'] as const) : [src];
		const rows: Doc<'cueCounters'>[] = [];
		for (const s of sources) {
			rows.push(...await ctx.db.query('cueCounters').withIndex('by_source_cue', (i) => {
				const q = i.eq('source', s).eq('cue', cue);
				return m ? q.eq('mode', m) : q;
			}).collect());
		}
		const sum = (k: 'trials' | 'decisions' | 'timely' | 'early' | 'overstayed' | 'caught') => rows.reduce((n, r) => n + r[k], 0);
		const n = sum('decisions');
		return {
			source: src, cue, mode: m ?? null,
			trials: sum('trials'),
			decisions: n,
			wellTimed: wilson(sum('timely'), n),
			tooLate: wilson(sum('overstayed') + sum('caught'), n),
			caught: wilson(sum('caught'), n),
			tooEarly: wilson(sum('early'), n),
			notEnoughData: n < ENOUGH,
			lastTrialAt: rows.reduce<number | null>((a, r) => (r.lastTrialAt !== null && (a === null || r.lastTrialAt > a) ? r.lastTrialAt : a), null)
		};
	}
});
