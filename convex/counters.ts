/**
 * Running totals per source (human, bot) for the live header (`live.counters`), so it reads one
 * small document instead of every trial. The write mutations add to them as rows arrive
 * (`participants.ensure`, `sessions.start`, `trials.save`); `admin.reclassify` and
 * `rebuildCounters` recount them from the tables. Study warm-up (practice) trials are not counted,
 * as everywhere else.
 */
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';
import { RULES_VERSION, isDecision } from './lib/rules';
import { source } from './validators';

export const counterFields = {
	source,
	trials: v.number(),
	engaged: v.number(),
	/** Eligible for the rates (engaged, ran out by itself, player stayed). */
	inRates: v.number(),
	/** Decision trials (current rules): the denominator of every rate. */
	decisions: v.number(),
	/** Eligible trials recorded before the current rules (cannot be recomputed): in no rate. Absent on old rows (0). */
	oldRules: v.optional(v.number()),
	clips: v.number(),
	sessions: v.number(),
	participants: v.number(),
	lastTrialAt: v.union(v.number(), v.null())
};

type Counts = Omit<Doc<'counters'>, '_id' | '_creationTime' | 'source'>;
const ZERO: Counts = { trials: 0, engaged: 0, inRates: 0, decisions: 0, oldRules: 0, clips: 0, sessions: 0, participants: 0, lastTrialAt: null };

/** Add to the totals of one source (creates the document on first use). */
export async function bump(ctx: MutationCtx, src: 'human' | 'bot', add: Partial<Counts>) {
	const row = await ctx.db.query('counters').withIndex('by_source', (i) => i.eq('source', src)).unique();
	const next: Counts = { ...ZERO, ...(row ?? {}) };
	for (const [k, val] of Object.entries(add) as [keyof Counts, number | null][]) {
		if (k === 'lastTrialAt') next.lastTrialAt = Math.max(next.lastTrialAt ?? 0, val ?? 0) || null;
		else (next[k] as number) += val ?? 0;
	}
	const { _id: _i, _creationTime: _c, source: _s, ...clean } = next as Counts & Partial<Doc<'counters'>>;
	if (row) await ctx.db.patch(row._id, clean);
	else await ctx.db.insert('counters', { source: src, ...clean });
}

/** What one stored trial adds to the totals. */
export function trialCounts(t: Pick<Doc<'trials'>, 'engaged' | 'inRates' | 'outcome' | 'rulesVersion' | 'clipId' | 'createdAt'>, clip: boolean): Partial<Counts> {
	return {
		trials: 1, engaged: t.engaged ? 1 : 0, inRates: t.inRates ? 1 : 0, decisions: isDecision(t) ? 1 : 0,
		oldRules: t.inRates && t.rulesVersion !== RULES_VERSION ? 1 : 0,
		clips: clip ? 1 : 0, lastTrialAt: t.createdAt
	};
}

const PAGE = 400;

/** Recount every source from the tables (in pages; schedules itself until done). */
export const rebuildCounters = mutation({
	args: { confirm: v.literal('rebuild counters') },
	handler: async (ctx) => {
		await ctx.scheduler.runAfter(0, internal.counters.rebuildStep, { stage: 'reset', cursor: null });
		return { started: true };
	}
});

export const rebuildStep = internalMutation({
	args: { stage: v.union(v.literal('reset'), v.literal('trials'), v.literal('sessions'), v.literal('participants')), cursor: v.union(v.string(), v.null()) },
	handler: async (ctx, { stage, cursor }) => {
		if (stage === 'reset') {
			for (const row of await ctx.db.query('counters').collect()) await ctx.db.delete(row._id);
			await ctx.scheduler.runAfter(0, internal.counters.rebuildStep, { stage: 'trials', cursor: null });
			return;
		}
		const add = { human: { ...ZERO }, bot: { ...ZERO } } as Record<'human' | 'bot', Counts>;
		const sum = (src: 'human' | 'bot', part: Partial<Counts>) => {
			const a = add[src];
			for (const [k, val] of Object.entries(part) as [keyof Counts, number | null][]) {
				if (k === 'lastTrialAt') a.lastTrialAt = Math.max(a.lastTrialAt ?? 0, val ?? 0) || null;
				else (a[k] as number) += val ?? 0;
			}
		};
		let page: { page: unknown[]; isDone: boolean; continueCursor: string };
		if (stage === 'trials') {
			const p = await ctx.db.query('trials').paginate({ numItems: PAGE, cursor });
			for (const t of p.page) if (!t.practice) sum(t.source, trialCounts(t, !!t.clipId));
			page = p;
		} else if (stage === 'sessions') {
			const p = await ctx.db.query('sessions').paginate({ numItems: PAGE, cursor });
			for (const s of p.page) sum(s.source, { sessions: 1 });
			page = p;
		} else {
			const p = await ctx.db.query('participants').paginate({ numItems: PAGE, cursor });
			for (const s of p.page) sum(s.source, { participants: 1 });
			page = p;
		}
		for (const src of ['human', 'bot'] as const) await bump(ctx, src, add[src]);
		const next = page.isDone ? (stage === 'trials' ? 'sessions' : stage === 'sessions' ? 'participants' : null) : stage;
		if (next) await ctx.scheduler.runAfter(0, internal.counters.rebuildStep, { stage: next, cursor: page.isDone ? null : page.continueCursor });
	}
});
