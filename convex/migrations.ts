/**
 * One-off data migrations. Each runs in batches, schedules itself until done, can be started again
 * at any time (rows already migrated are skipped), and logs a line to the Convex log when finished.
 * None of them deletes a row.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation } from './_generated/server';

/** Trials per step: each moves about 1 KB of series and rewrites a ~2 KB row. */
const BATCH = 200;

/**
 * Move every trial's packed series into `trialSeries` (one row per trial) and drop it from the trial
 * row, and fill `simRun` from the session's simulator run. Safe to run again: a trial that already
 * has its `trialSeries` row keeps it, and its legacy copy is only removed once the copy exists.
 */
export const slimTrials = mutation({
	args: { confirm: v.literal('slim trials') },
	handler: async (ctx) => {
		await ctx.scheduler.runAfter(0, internal.migrations.slimTrialsStep, { cursor: null, seen: 0, moved: 0, runs: 0 });
		return { started: true };
	}
});

export const slimTrialsStep = internalMutation({
	args: { cursor: v.union(v.string(), v.null()), seen: v.number(), moved: v.number(), runs: v.number() },
	handler: async (ctx, a) => {
		const page = await ctx.db.query('trials').paginate({ numItems: BATCH, cursor: a.cursor });
		let { seen, moved, runs } = a;
		const sessions = new Map<Id<'sessions'>, Doc<'sessions'> | null>();
		for (const t of page.page) {
			seen++;
			if (!sessions.has(t.sessionId)) sessions.set(t.sessionId, await ctx.db.get(t.sessionId));
			const simRun = sessions.get(t.sessionId)?.sim?.run;
			const legacy = (t as Doc<'trials'> & { series?: ArrayBuffer }).series;
			const patch: Partial<Doc<'trials'>> & { series?: undefined } = {};
			if (simRun && t.simRun !== simRun) { patch.simRun = simRun; runs++; }
			if (legacy) {
				const has = await ctx.db.query('trialSeries').withIndex('by_trial', (i) => i.eq('trialId', t._id)).unique();
				if (!has) {
					await ctx.db.insert('trialSeries', {
						trialId: t._id, sessionId: t.sessionId, cue: t.cue, source: t.source, mode: t.mode,
						createdAt: t.createdAt, series: legacy, ...(simRun ? { simRun } : {})
					});
				}
				patch.series = undefined;
				moved++;
			}
			if (Object.keys(patch).length) await ctx.db.patch(t._id, patch);
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.migrations.slimTrialsStep, { cursor: page.continueCursor, seen, moved, runs });
		} else {
			console.log(`slimTrials: ${seen} trials, ${moved} series moved to trialSeries, ${runs} given their simRun`);
		}
		return { seen, moved, runs, done: page.isDone };
	}
});

/** Progress of `slimTrials`: trial rows still carrying their series (counts at most `limit`). */
export const slimTrialsLeft = internalQuery({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit = 20000 }) => {
		let left = 0, n = 0;
		for await (const t of ctx.db.query('trials')) {
			if (++n > limit) break;
			if ((t as Doc<'trials'> & { series?: ArrayBuffer }).series) left++;
		}
		return { checked: Math.min(n, limit), left };
	}
});
