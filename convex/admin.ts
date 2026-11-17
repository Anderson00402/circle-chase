/**
 * Clearing and re-scoring data. The clearing mutations ask for a confirmation phrase so they cannot be called by accident,
 * delete in batches, and schedule themselves again until everything is gone.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { TableNames } from './_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';
import { RULES_VERSION, rescore } from './lib/rules';
import type { Doc, Id } from './_generated/dataModel';
import { rowOf } from './lib/digest';
import { patchReplayRows } from './lib/replayDigest';

const TABLES: TableNames[] = ['clips', 'trialSeries', 'trialDigests', 'replayDigests', 'trials', 'ratings', 'blocks', 'presence', 'sessions', 'participants', 'counters'];
/** Clips are the heavy rows (10-15 KB); keep a batch well inside one mutation's limits. */
const BATCH: Partial<Record<TableNames, number>> = { clips: 200, trialDigests: 20, replayDigests: 20 };
const DEFAULT_BATCH = 500;
/** Rows one call may read in all, well under Convex's 4,096 reads per function. */
const READ_BUDGET = 2000;

async function purge(ctx: MutationCtx, onlyBots: boolean) {
	const deleted: Record<string, number> = {};
	let more = false, budget = READ_BUDGET;
	for (const table of TABLES) {
		if (budget <= 0) { more = true; break; }
		const limit = Math.min(BATCH[table] ?? DEFAULT_BATCH, budget);
		const q = ctx.db.query(table);
		const rows = onlyBots
			? await q.filter((f) => f.eq(f.field('source'), 'bot')).take(limit)
			: await q.take(limit);
		for (const r of rows) await ctx.db.delete(r._id);
		deleted[table] = rows.length;
		budget -= rows.length;
		if (rows.length === limit) more = true;
	}
	return { deleted, more };
}

/** Delete every row with `source: 'bot'` (participants, sessions, blocks, trials, clips, ratings, presence, counters). */
export const deleteBotData = mutation({
	args: { confirm: v.literal('delete bot data') },
	handler: async (ctx) => {
		const r = await purge(ctx, true);
		if (r.more) await ctx.scheduler.runAfter(0, internal.admin.continuePurge, { onlyBots: true });
		return { ...r, continuing: r.more };
	}
});

/** Delete everything in every table, for a fresh demo. Cannot be undone. */
export const wipeEverything = mutation({
	args: { confirm: v.literal('wipe everything') },
	handler: async (ctx) => {
		const r = await purge(ctx, false);
		if (r.more) await ctx.scheduler.runAfter(0, internal.admin.continuePurge, { onlyBots: false });
		return { ...r, continuing: r.more };
	}
});

export const continuePurge = internalMutation({
	args: { onlyBots: v.boolean() },
	handler: async (ctx, { onlyBots }) => {
		const r = await purge(ctx, onlyBots);
		if (r.more) await ctx.scheduler.runAfter(0, internal.admin.continuePurge, { onlyBots });
		return r;
	}
});

/** Trials per reclassify step: each may also patch its clip (10-15 KB). */
const RECLASSIFY_BATCH = 200;

/**
 * Recompute `outcome` (and `rulesVersion`, `wasted`, `inRates`, `gaveUpEarly`) of every trial and its clip from the stored
 * raw measures with the current rules (convex/lib/rules.ts). A row that lacks a measure the rules
 * need keeps its outcome and is marked `rulesVersion: 1`, which leaves it out of every rate. Runs
 * in batches and schedules itself; recounts the live counters at the end.
 */
export const reclassify = mutation({
	args: { confirm: v.literal('reclassify') },
	handler: async (ctx) => {
		await ctx.scheduler.runAfter(0, internal.admin.reclassifyStep, { cursor: null, seen: 0, changed: 0, old: 0 });
		return { started: true, rulesVersion: RULES_VERSION };
	}
});

export const reclassifyStep = internalMutation({
	args: { cursor: v.union(v.string(), v.null()), seen: v.number(), changed: v.number(), old: v.number() },
	handler: async (ctx, a) => {
		const page = await ctx.db.query('trials').paginate({ numItems: RECLASSIFY_BATCH, cursor: a.cursor });
		let { seen, changed, old } = a;
		const touched = new Map<Id<'sessions'>, Doc<'trials'>[]>();
		for (const t of page.page) {
			seen++;
			const r = rescore(t);
			if (r.rulesVersion !== RULES_VERSION) old++;
			// Everything rescore derives (outcome, version, wasted, and from rules 3 inRates and gaveUpEarly).
			if ((Object.keys(r) as (keyof typeof r)[]).every((k) => r[k] === (t as Record<string, unknown>)[k])) continue;
			changed++;
			await ctx.db.patch(t._id, r);
			touched.set(t.sessionId, [...(touched.get(t.sessionId) ?? []), { ...t, ...r } as Doc<'trials'>]);
			if (t.clipId) {
				const clip = await ctx.db.get(t.clipId);
				if (clip && (clip.outcome !== r.outcome || clip.numbers.outcome !== r.outcome)) {
					await ctx.db.patch(clip._id, { outcome: r.outcome, numbers: { ...clip.numbers, outcome: r.outcome } });
				}
			}
		}
		// The dashboard's digests: one write per session touched, keeping each trial's stored curve.
		for (const [sessionId, ts] of touched) {
			const d = await ctx.db.query('trialDigests').withIndex('by_session', (i) => i.eq('sessionId', sessionId)).unique();
			if (!d) continue;
			const byId = new Map(ts.map((t) => [t._id, t]));
			await ctx.db.patch(d._id, { rows: d.rows.map((row) => (byId.has(row.id) ? rowOf(byId.get(row.id)!, undefined, row) : row)) });
		}
		// The replay browser's digests likewise.
		for (const [sessionId, ts] of touched) await patchReplayRows(ctx, sessionId, ts);
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.admin.reclassifyStep, { cursor: page.continueCursor, seen, changed, old });
		} else {
			console.log(`reclassify: ${seen} trials, ${changed} changed, ${old} left on rules version 1`);
			await ctx.scheduler.runAfter(0, internal.counters.rebuildStep, { stage: 'reset', cursor: null });
		}
		return { seen, changed, old, done: page.isDone };
	}
});
