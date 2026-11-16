/**
 * Clearing and re-scoring data. The clearing mutations ask for a confirmation phrase so they cannot be called by accident,
 * delete in batches, and schedule themselves again until everything is gone.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { TableNames } from './_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';
import { RULES_VERSION, rescore } from './lib/rules';

const TABLES: TableNames[] = ['clips', 'trials', 'ratings', 'blocks', 'presence', 'sessions', 'participants', 'counters'];
/** Clips are the heavy rows (10-15 KB); keep a batch well inside one mutation's limits. */
const BATCH: Partial<Record<TableNames, number>> = { clips: 200 };
const DEFAULT_BATCH = 1000;

async function purge(ctx: MutationCtx, onlyBots: boolean) {
	const deleted: Record<string, number> = {};
	let more = false;
	for (const table of TABLES) {
		const limit = BATCH[table] ?? DEFAULT_BATCH;
		const q = ctx.db.query(table);
		const rows = onlyBots
			? await q.filter((f) => f.eq(f.field('source'), 'bot')).take(limit)
			: await q.take(limit);
		for (const r of rows) await ctx.db.delete(r._id);
		deleted[table] = rows.length;
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
 * Recompute `outcome` (and `rulesVersion`, `wasted`) of every trial and its clip from the stored
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
		for (const t of page.page) {
			seen++;
			const r = rescore(t);
			if (r.rulesVersion !== RULES_VERSION) old++;
			if (r.outcome === t.outcome && r.rulesVersion === t.rulesVersion && r.wasted === t.wasted) continue;
			changed++;
			await ctx.db.patch(t._id, r);
			if (t.clipId) {
				const clip = await ctx.db.get(t.clipId);
				if (clip && (clip.outcome !== r.outcome || clip.numbers.outcome !== r.outcome)) {
					await ctx.db.patch(clip._id, { outcome: r.outcome, numbers: { ...clip.numbers, outcome: r.outcome } });
				}
			}
		}
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.admin.reclassifyStep, { cursor: page.continueCursor, seen, changed, old });
		} else {
			console.log(`reclassify: ${seen} trials, ${changed} changed, ${old} left on rules version 1`);
			await ctx.scheduler.runAfter(0, internal.counters.rebuildStep, { stage: 'reset', cursor: null });
		}
		return { seen, changed, old, done: page.isDone };
	}
});
