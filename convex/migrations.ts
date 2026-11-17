/**
 * One-off data migrations. Each runs in batches, schedules itself until done, can be started again
 * at any time (rows already migrated are skipped), and logs a line to the Convex log when finished.
 * None of them deletes a row.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation } from './_generated/server';
import { rebuildSessionCells } from './lib/digest';

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

/**
 * Give `runNumber` to the participants that already played through the run console (a session
 * with `run` info), per source in order of first visit, after any run numbers already given. Their
 * `number` and the sessions' stored `run.participantNumber` stay as they were. Safe to run again.
 */
export const numberRunParticipants = mutation({
	args: { confirm: v.literal('number run participants') },
	handler: async (ctx) => {
		const given: Record<string, number> = {};
		for (const src of ['human', 'bot'] as const) {
			const people = await ctx.db.query('participants').withIndex('by_source', (i) => i.eq('source', src)).collect();
			let next = people.reduce((m, p) => Math.max(m, p.runNumber ?? 0), 0);
			given[src] = 0;
			for (const p of people) {
				if (p.runNumber !== undefined) continue;
				const sessions = await ctx.db.query('sessions').withIndex('by_participant', (i) => i.eq('participantId', p._id)).collect();
				if (!sessions.some((s) => s.run)) continue;
				await ctx.db.patch(p._id, { runNumber: ++next });
				given[src]++;
			}
		}
		return given;
	}
});

/**
 * Work out every session's dashboard totals (`trialCells`) again from its digest rows, after the
 * arithmetic in convex/lib/cells.ts changed (2026-11-16: "gave up very early" counts only trials
 * classed too early, and decisions cut by a maze clear are counted). Reads digests, rewrites only
 * the small totals documents; trial rows and digests are not touched. Safe to run again.
 *   npx convex run migrations:rebuildCells '{"confirm": "rebuild cells"}'
 */
export const rebuildCells = mutation({
	args: { confirm: v.literal('rebuild cells') },
	handler: async (ctx) => {
		await ctx.scheduler.runAfter(0, internal.migrations.rebuildCellsStep, { cursor: null, sessions: 0, rows: 0 });
		return { started: true };
	}
});

export const rebuildCellsStep = internalMutation({
	args: { cursor: v.union(v.string(), v.null()), sessions: v.number(), rows: v.number() },
	handler: async (ctx, a) => {
		const page = await ctx.db.query('sessions').paginate({ numItems: 10, cursor: a.cursor });
		let { sessions, rows } = a;
		for (const s of page.page) {
			const n = await rebuildSessionCells(ctx, s._id);
			if (n) { sessions++; rows += n; }
		}
		if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.rebuildCellsStep, { cursor: page.continueCursor, sessions, rows });
		else console.log(`rebuildCells: ${sessions} sessions, ${rows} digest rows`);
	}
});
