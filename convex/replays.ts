import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import { RULES_VERSION } from './lib/rules';
import { mode, sourceFilter } from './validators';

/**
 * The replay browser's read side. Filtering and sorting happen here, so the list page receives one
 * page of light rows (not every trial) and the player asks only for its neighbours.
 *
 * Reads trials (light since the series moved to `trialSeries`), never the clips themselves.
 */

/** Most trials scanned per query. */
const LIMIT = 4000;

export const SORT_VALUES = ['newest', 'closest', 'caught', 'turn-early', 'turn-late'] as const;
export type Sort = (typeof SORT_VALUES)[number];
const sortArg = v.optional(v.union(...SORT_VALUES.map((s) => v.literal(s))));

const listArgs = {
	source: v.optional(sourceFilter),
	mode: v.optional(mode),
	cue: v.optional(v.string()),
	outcome: v.optional(v.string()),
	/** Participant number as text; '' or absent for everyone. */
	participant: v.optional(v.string()),
	sort: sortArg
};
type ListArgs = { source?: 'human' | 'bot' | 'all'; mode?: 'study' | 'arcade'; cue?: string; outcome?: string; participant?: string; sort?: Sort };

/** A light row for the browser and its cards. */
function toRow(t: Doc<'trials'>, p: Doc<'participants'> | null) {
	const last = t.eats.length ? t.eats[t.eats.length - 1] : null;
	return {
		trialId: t._id,
		clipId: t.clipId!,
		cue: t.cue,
		outcome: t.outcome,
		source: t.source,
		mode: t.mode,
		createdAt: t.createdAt,
		participant: p ? p.number : null,
		/** What the researcher typed (or "P07" when nothing was typed). */
		label: p?.nickname ?? (p ? `P${String(p.number).padStart(2, '0')}` : null),
		blockIndex: t.blockIndex,
		trialIndex: t.trialIndex,
		startedAt: t.startedAt,
		endedAt: t.endedAt,
		endReason: t.endReason,
		total: t.total,
		turnAt: t.turnAt,
		turnLeft: t.turnLeft,
		turnDist: t.turnDist,
		endDist: t.endDist,
		lastChaseEnd: t.lastChaseEnd ?? null,
		eats: t.eats.length,
		lastEatAt: last ? t.startedAt + last.t : null,
		lastEatLeft: last ? last.left : null,
		caught: t.after.caught,
		died: t.after.died,
		timeToCaught: t.after.timeToCaught,
		nearMiss: t.after.nearMiss,
		engaged: t.engaged,
		inRates: t.inRates,
		/** Classed by rules older than the current ones (shown with a tag, left out of the rates). */
		oldRules: (t.rulesVersion ?? 1) !== RULES_VERSION
	};
}
export type MomentRow = ReturnType<typeof toRow>;

/** Every trial with a clip for the source / mode / cue, newest first, as light rows. */
async function moments(ctx: QueryCtx, a: Pick<ListArgs, 'source' | 'mode' | 'cue'>) {
	const src = a.source ?? 'human';
	const q = ctx.db.query('trials');
	const all = a.cue
		? src === 'all'
			? await q.withIndex('by_cue_created', (i) => i.eq('cue', a.cue!)).order('desc').take(LIMIT)
			: await q.withIndex('by_source_cue', (i) => i.eq('source', src).eq('cue', a.cue!)).order('desc').take(LIMIT)
		: src === 'all'
			? await q.withIndex('by_created').order('desc').take(LIMIT)
			: await q.withIndex('by_source_created', (i) => i.eq('source', src)).order('desc').take(LIMIT);
	// Warm-up (practice) trials are not part of the study and stay out, like everywhere else.
	const trials = all.filter((t) => t.clipId && !t.practice && (!a.mode || t.mode === a.mode));
	const people = new Map<Id<'participants'>, Doc<'participants'> | null>();
	for (const t of trials) if (!people.has(t.participantId)) people.set(t.participantId, await ctx.db.get(t.participantId));
	return { rows: trials.map((t) => toRow(t, people.get(t.participantId) ?? null)), truncated: all.length === LIMIT };
}

const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) =>
	a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : (a - b) * dir;

export function sortMoments<T extends Pick<MomentRow, 'createdAt' | 'endDist' | 'caught' | 'timeToCaught' | 'turnLeft'>>(rows: T[], sort: Sort = 'newest'): T[] {
	const out = [...rows];
	const newest = (a: T, b: T) => b.createdAt - a.createdAt;
	switch (sort) {
		case 'closest': return out.sort((a, b) => nullsLast(a.endDist, b.endDist, 1) || newest(a, b));
		case 'caught': return out.sort((a, b) => Number(b.caught) - Number(a.caught) || nullsLast(a.timeToCaught, b.timeToCaught, 1) || newest(a, b));
		case 'turn-early': return out.sort((a, b) => nullsLast(a.turnLeft, b.turnLeft, -1) || newest(a, b));
		case 'turn-late': return out.sort((a, b) => nullsLast(a.turnLeft, b.turnLeft, 1) || newest(a, b));
		default: return out.sort(newest);
	}
}

const matches = (r: MomentRow, a: Pick<ListArgs, 'outcome' | 'participant'>) =>
	(!a.outcome || r.outcome === a.outcome) && (!a.participant || String(r.participant) === a.participant);

/**
 * One page of the replay browser: the first `limit` moments matching the filters in the chosen
 * order, how many match in all, counts for the outcome chips (every filter but the outcome), the
 * participants on the list, and whether any human or simulated clips exist (for the empty states).
 */
export const list = query({
	args: { ...listArgs, limit: v.optional(v.number()) },
	handler: async (ctx, a) => {
		const { rows, truncated } = await moments(ctx, a);
		const base = rows.filter((r) => matches(r, { participant: a.participant }));
		const outcomes: Record<string, number> = {};
		for (const r of base) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
		const hits = sortMoments(base.filter((r) => matches(r, { outcome: a.outcome })), a.sort);
		const people = new Map<number, string>();
		for (const r of rows) if (r.participant !== null && !people.has(r.participant)) people.set(r.participant, r.label ?? `P${r.participant}`);
		const has = {
			human: (await ctx.db.query('clips').withIndex('by_source_created', (i) => i.eq('source', 'human')).first()) !== null,
			bot: (await ctx.db.query('clips').withIndex('by_source_created', (i) => i.eq('source', 'bot')).first()) !== null
		};
		return {
			rows: hits.slice(0, Math.max(1, Math.min(a.limit ?? 48, 500))),
			total: hits.length,
			all: base.length,
			outcomes,
			participants: [...people.entries()].sort((x, y) => x[0] - y[0]).map(([number, label]) => ({ number, label })),
			has,
			truncated
		};
	}
});

/**
 * Previous and next moment around one trial in the list as filtered and sorted, and its position:
 * all the player needs for its Previous / Next buttons.
 */
export const neighbours = query({
	args: { trialId: v.id('trials'), ...listArgs },
	handler: async (ctx, a) => {
		const { rows } = await moments(ctx, a);
		const list = sortMoments(rows.filter((r) => matches(r, a)), a.sort);
		const i = list.findIndex((r) => r.trialId === a.trialId);
		return {
			prev: i > 0 ? list[i - 1].trialId : null,
			next: i >= 0 && i + 1 < list.length ? list[i + 1].trialId : null,
			pos: i,
			count: list.length
		};
	}
});
