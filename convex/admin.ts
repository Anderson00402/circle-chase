/**
 * Clearing data. Both mutations ask for a confirmation phrase so they cannot be called by accident,
 * delete in batches, and schedule themselves again until everything is gone.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { TableNames } from './_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';

const TABLES: TableNames[] = ['clips', 'trials', 'ratings', 'blocks', 'presence', 'sessions', 'participants'];
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

/** Delete every row with `source: 'bot'` (participants, sessions, blocks, trials, clips, ratings, presence). */
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
