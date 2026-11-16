/**
 * The filter every read query accepts, and the one place that turns it into an index scan.
 * Summary queries read all trials of the filter in one go; see convex/README.md for the limit.
 */
import { v, type Infer } from 'convex/values';
import type { Query } from 'convex/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { NamedTableInfo } from 'convex/server';
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
	/** One simulator run (`sessions.sim.run`, stored on trials as `simRun`). Only simulated rows have one. */
	run: v.optional(v.string()),
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
		&& (!f.run || t.simRun === f.run)
		&& (!!f.includePractice || !t.practice)
		&& t.createdAt >= (f.from ?? 0)
		&& t.createdAt <= (f.to ?? Number.MAX_SAFE_INTEGER);
}

type TrialQuery = Query<NamedTableInfo<DataModel, 'trials'>>;

/**
 * The narrowest index range for a filter, in `createdAt` order. Rows in the range may still fail
 * the rest of the filter: check each with `matches` (or use `scanTrials`).
 */
export function trialRange(ctx: QueryCtx, f: Filter): TrialQuery {
	const src = f.source ?? 'human';
	const from = f.from ?? 0, to = f.to ?? Number.MAX_SAFE_INTEGER;
	const t = ctx.db.query('trials');
	const { sessionId, participantId, run, cue } = f;
	if (sessionId) return t.withIndex('by_session', (i) => i.eq('sessionId', sessionId).gte('createdAt', from).lte('createdAt', to));
	if (run) return t.withIndex('by_run', (i) => i.eq('simRun', run).gte('createdAt', from).lte('createdAt', to));
	if (participantId) return t.withIndex('by_participant', (i) => i.eq('participantId', participantId).gte('createdAt', from).lte('createdAt', to));
	if (src !== 'all' && cue) return t.withIndex('by_source_cue', (i) => i.eq('source', src).eq('cue', cue).gte('createdAt', from).lte('createdAt', to));
	if (src !== 'all') return t.withIndex('by_source_created', (i) => i.eq('source', src).gte('createdAt', from).lte('createdAt', to));
	if (cue) return t.withIndex('by_cue_created', (i) => i.eq('cue', cue).gte('createdAt', from).lte('createdAt', to));
	return t.withIndex('by_created', (i) => i.gte('createdAt', from).lte('createdAt', to));
}

/** All trials matching the filter, oldest first. Picks the narrowest index. */
export async function scanTrials(ctx: QueryCtx, f: Filter): Promise<Doc<'trials'>[]> {
	return (await trialRange(ctx, f).collect()).filter((r) => matches(r, f));
}

/**
 * A trial row as lists and summaries return it. Trial rows no longer hold the series (it is in
 * `trialSeries`); this drops the legacy copy from rows the migration has not reached yet.
 */
export function light<T extends Doc<'trials'>>(t: T): Omit<T, 'series'> {
	const { series: _series, ...rest } = t as T & { series?: unknown };
	return rest;
}
