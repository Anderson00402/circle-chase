/**
 * The filter every read query accepts, and the one place that turns it into an index scan.
 * Summary queries read all trials of the filter in one go; see convex/README.md for the limit.
 */
import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { mode, sourceFilter } from '../validators';

export const filterArgs = {
	/** human (default), bot or all. Bot data is never mixed in unless asked for. */
	source: v.optional(sourceFilter),
	mode: v.optional(mode),
	cue: v.optional(v.string()),
	/** Server time range, ms since 1970 (inclusive). */
	from: v.optional(v.number()),
	to: v.optional(v.number()),
	participantId: v.optional(v.id('participants')),
	sessionId: v.optional(v.id('sessions')),
	/** Include study warm-up trials (left out by default). */
	includePractice: v.optional(v.boolean())
};
const filterObject = v.object(filterArgs);
export type Filter = Infer<typeof filterObject>;

export function matches(t: Doc<'trials'>, f: Filter): boolean {
	const src = f.source ?? 'human';
	return (src === 'all' || t.source === src)
		&& (!f.mode || t.mode === f.mode)
		&& (!f.cue || t.cue === f.cue)
		&& (!f.participantId || t.participantId === f.participantId)
		&& (!f.sessionId || t.sessionId === f.sessionId)
		&& (!!f.includePractice || !t.practice)
		&& t.createdAt >= (f.from ?? 0)
		&& t.createdAt <= (f.to ?? Number.MAX_SAFE_INTEGER);
}

/** All trials matching the filter, oldest first. Picks the narrowest index. */
export async function scanTrials(ctx: QueryCtx, f: Filter): Promise<Doc<'trials'>[]> {
	const src = f.source ?? 'human';
	const from = f.from ?? 0, to = f.to ?? Number.MAX_SAFE_INTEGER;
	const t = ctx.db.query('trials');
	let rows: Doc<'trials'>[];
	if (f.sessionId) {
		const id: Id<'sessions'> = f.sessionId;
		rows = await t.withIndex('by_session', (i) => i.eq('sessionId', id).gte('createdAt', from).lte('createdAt', to)).collect();
	} else if (f.participantId) {
		const id: Id<'participants'> = f.participantId;
		rows = await t.withIndex('by_participant', (i) => i.eq('participantId', id).gte('createdAt', from).lte('createdAt', to)).collect();
	} else if (src !== 'all' && f.cue) {
		const cue = f.cue;
		rows = await t.withIndex('by_source_cue', (i) => i.eq('source', src).eq('cue', cue).gte('createdAt', from).lte('createdAt', to)).collect();
	} else if (src !== 'all') {
		rows = await t.withIndex('by_source_created', (i) => i.eq('source', src).gte('createdAt', from).lte('createdAt', to)).collect();
	} else if (f.cue) {
		const cue = f.cue;
		rows = await t.withIndex('by_cue_created', (i) => i.eq('cue', cue).gte('createdAt', from).lte('createdAt', to)).collect();
	} else {
		rows = await t.withIndex('by_created', (i) => i.gte('createdAt', from).lte('createdAt', to)).collect();
	}
	return rows.filter((r) => matches(r, f));
}

/** A trial without its packed series: what lists and summaries return. */
export function light(t: Doc<'trials'>) {
	const { series: _series, ...rest } = t;
	return rest;
}
