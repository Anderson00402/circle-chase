import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, query, type QueryCtx } from './_generated/server';
import { RULES_VERSION } from './lib/rules';
import { rebuildReplayDigest, type ReplayRow } from './lib/replayDigest';
import { mode, sourceFilter } from './validators';

/**
 * The replay browser's read side. It reads the replay digests (convex/lib/replayDigest.ts: one
 * document per session with a slim row per trial that has a clip), never trial rows or clips, so a
 * list of 16,000 simulated trials costs about a hundred document reads. The source and the
 * participant are picked by index; condition, rules, outcome and the sort are applied to the rows
 * in memory (a few milliseconds for ten thousand rows). Nothing is cut off.
 */

export const SORT_VALUES = ['newest', 'closest', 'caught', 'turn-early', 'turn-late'] as const;
export type Sort = (typeof SORT_VALUES)[number];
const sortArg = v.optional(v.union(...SORT_VALUES.map((s) => v.literal(s))));

const listArgs = {
	source: v.optional(sourceFilter),
	mode: v.optional(mode),
	cue: v.optional(v.string()),
	outcome: v.optional(v.string()),
	/** A participant id (`participants` document id); '' or absent for everyone. A plain number is read as a run-console number. */
	participant: v.optional(v.string()),
	sort: sortArg
};
type ListArgs = { source?: 'human' | 'bot' | 'all'; mode?: 'study' | 'arcade'; cue?: string; outcome?: string; participant?: string; sort?: Sort };

type Digest = Doc<'replayDigests'>;

/** A light row for the browser and its cards. */
function toRow(r: ReplayRow, d: Digest) {
	return {
		trialId: r.id,
		cue: r.cue,
		outcome: r.outcome,
		source: d.source,
		mode: r.mode,
		createdAt: r.createdAt,
		participantId: d.participantId,
		/** The participant as shown everywhere (`participantName`). */
		label: d.name,
		blockIndex: r.blockIndex,
		trialIndex: r.trialIndex,
		startedAt: r.startedAt,
		endedAt: r.endedAt,
		endReason: r.endReason,
		total: r.total,
		turnAt: r.turnAt,
		turnLeft: r.turnLeft,
		turnDist: r.turnDist,
		endDist: r.endDist,
		lastChaseEnd: r.lastChaseEnd,
		eats: r.eats,
		lastEatAt: r.lastEatT === null ? null : r.startedAt + r.lastEatT,
		lastEatLeft: r.lastEatLeft,
		caught: r.caught,
		died: r.died,
		diedDuring: r.diedDuring,
		timeToCaught: r.timeToCaught,
		nearMiss: r.nearMiss,
		engaged: r.engaged,
		inRates: r.inRates,
		/** Classed by rules older than the current ones (shown with a tag, left out of the rates). */
		oldRules: r.rulesVersion !== RULES_VERSION
	};
}
export type MomentRow = ReturnType<typeof toRow>;

/** The digests of a source, by index. */
async function bySource(ctx: QueryCtx, source: ListArgs['source']): Promise<Digest[]> {
	const src = source ?? 'human';
	const read = (s: 'human' | 'bot') => ctx.db.query('replayDigests').withIndex('by_source', (i) => i.eq('source', s)).collect();
	return src === 'all' ? [...(await read('human')), ...(await read('bot'))] : await read(src);
}

/** Keep one participant's digests: by id, or (an old link, `?p=5`) by run-console number. */
function ofParticipant(ds: Digest[], participant: string | undefined): Digest[] {
	if (!participant) return ds;
	if (/^\d+$/.test(participant)) return ds.filter((d) => d.runNumber === Number(participant));
	return ds.filter((d) => d.participantId === participant);
}

/** The digests for a source and one participant, read by the participant index (Previous / Next). */
async function ofOne(ctx: QueryCtx, a: Pick<ListArgs, 'source' | 'participant'>): Promise<Digest[]> {
	const pid = a.participant ? ctx.db.normalizeId('participants', a.participant) : null;
	if (!pid) return ofParticipant(await bySource(ctx, a.source), a.participant);
	const src = a.source ?? 'human';
	const ds = await ctx.db.query('replayDigests').withIndex('by_participant', (i) => i.eq('participantId', pid)).collect();
	return ds.filter((d) => src === 'all' || d.source === src);
}

/** Every listed moment of these digests matching the rules and condition, as light rows. */
function moments(ds: Digest[], a: Pick<ListArgs, 'cue' | 'mode'>): MomentRow[] {
	const rows: MomentRow[] = [];
	for (const d of ds) {
		for (const r of d.rows) {
			if ((a.cue && r.cue !== a.cue) || (a.mode && r.mode !== a.mode)) continue;
			rows.push(toRow(r, d));
		}
	}
	return rows;
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

/** Whether any human or simulated replay exists (for the empty states), reusing what was read. */
async function hasAny(ctx: QueryCtx, src: ListArgs['source'], ds: Digest[]) {
	const known = (s: 'human' | 'bot') => ((src === s || src === 'all') ? ds.some((d) => d.source === s && d.rows.length > 0) : null);
	const look = async (s: 'human' | 'bot') =>
		known(s) ?? (await ctx.db.query('replayDigests').withIndex('by_source', (i) => i.eq('source', s)).first()) !== null;
	return { human: await look('human'), bot: await look('bot') };
}

/**
 * One page of the replay browser: the first `limit` moments matching the filters in the chosen
 * order, how many match in all, counts for the outcome chips (every filter but the outcome), the
 * participants on the list, and whether any human or simulated clips exist (for the empty states).
 */
export const list = query({
	args: { ...listArgs, limit: v.optional(v.number()) },
	handler: async (ctx, a) => {
		// One read of the source: the participant menu lists everyone in it, not only the one picked.
		const everyone = await bySource(ctx, a.source);
		const rows = moments(ofParticipant(everyone, a.participant), a);
		const outcomes: Record<string, number> = {};
		for (const r of rows) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
		const hits = sortMoments(a.outcome ? rows.filter((r) => r.outcome === a.outcome) : rows, a.sort);
		const people = new Map<Id<'participants'>, { id: Id<'participants'>; label: string; runNumber: number | null; source: 'human' | 'bot' }>();
		for (const d of everyone) if (d.rows.length && !people.has(d.participantId)) people.set(d.participantId, { id: d.participantId, label: d.name, runNumber: d.runNumber, source: d.source });
		const participants = [...people.values()].sort((x, y) =>
			x.source.localeCompare(y.source) || (x.runNumber ?? 1e9) - (y.runNumber ?? 1e9) || x.label.localeCompare(y.label, undefined, { numeric: true }));
		return {
			rows: hits.slice(0, Math.max(1, Math.min(a.limit ?? 48, 500))),
			total: hits.length,
			all: rows.length,
			outcomes,
			participants,
			has: await hasAny(ctx, a.source ?? 'human', everyone),
			/** Kept for older pages: the list is never cut off now. */
			truncated: false
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
		const rows = moments(await ofOne(ctx, a), a);
		const list = sortMoments(a.outcome ? rows.filter((r) => r.outcome === a.outcome) : rows, a.sort);
		const i = list.findIndex((r) => r.trialId === a.trialId);
		return {
			prev: i > 0 ? list[i - 1].trialId : null,
			next: i >= 0 && i + 1 < list.length ? list[i + 1].trialId : null,
			pos: i,
			count: list.length
		};
	}
});

/**
 * Build the replay digests from the trial rows, a few sessions per call: `npx convex run
 * replays:rebuildDigests '{"cursor": null}'`, then again with the returned cursor until `isDone`.
 * Only writes replay digests.
 */
export const rebuildDigests = internalMutation({
	args: { cursor: v.union(v.string(), v.null()), batch: v.optional(v.number()) },
	handler: async (ctx, { cursor, batch = 6 }) => {
		const page = await ctx.db.query('sessions').paginate({ cursor, numItems: batch });
		let rows = 0;
		for (const s of page.page) rows += await rebuildReplayDigest(ctx, s._id as Id<'sessions'>);
		return { cursor: page.continueCursor, isDone: page.isDone, sessions: page.page.length, rows };
	}
});

/**
 * The clip of a trial for the player, wrapped so the answer is never a bare null: convex-svelte does
 * not notice a result that goes from null (the previous trial had no clip) to null (neither has this
 * one), which left the player waiting forever when stepping between trials without a recording.
 */
export const clipOf = query({
	args: { trialId: v.id('trials') },
	handler: async (ctx, { trialId }) => ({
		trialId,
		clip: await ctx.db.query('clips').withIndex('by_trial', (i) => i.eq('trialId', trialId)).unique()
	})
});
