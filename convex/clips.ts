import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { query } from './_generated/server';
import { outcome, sourceFilter } from './validators';

/** The clip of a trial, with its packed data (decode with `decodeClip` from #lib/telemetry/recorder.ts). */
export const byTrial = query({
	args: { trialId: v.id('trials') },
	handler: async (ctx, { trialId }) => ctx.db.query('clips').withIndex('by_trial', (i) => i.eq('trialId', trialId)).unique()
});

export const get = query({
	args: { id: v.id('clips') },
	handler: async (ctx, { id }) => ctx.db.get(id)
});

/** A clip without its data: what lists show. */
function card(c: Doc<'clips'>) {
	const { data: _data, ...rest } = c;
	return rest;
}

/** Stored moments, newest first, filterable by cue, outcome and source. Rows come without data. */
export const moments = query({
	args: {
		cue: v.optional(v.string()),
		outcome: v.optional(outcome),
		source: v.optional(sourceFilter),
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, a) => {
		const src = a.source ?? 'human';
		const c = ctx.db.query('clips');
		const base = a.cue
			? c.withIndex('by_cue', (i) => i.eq('cue', a.cue!))
			: a.outcome
				? c.withIndex('by_outcome', (i) => i.eq('outcome', a.outcome!))
				: src !== 'all'
					? c.withIndex('by_source_created', (i) => i.eq('source', src))
					: c.withIndex('by_created');
		const page = await base
			.order('desc')
			.filter((q) => q.and(
				src === 'all' ? true : q.eq(q.field('source'), src),
				a.outcome ? q.eq(q.field('outcome'), a.outcome) : true
			))
			.paginate(a.paginationOpts);
		return { ...page, page: page.page.map(card) };
	}
});
