/**
 * Runs, as the researcher's console sees them. A participant label ("P07") has its own participant
 * row and one session; each run of one case is a block of that session (`orderIndex` = position
 * of the run in the session, `mode` = the rules of that run). Blocks and trials are written by the
 * normal telemetry functions; this file adds the session's run info, notes on a block, and the
 * read side of the run sheet and the end-of-run summary.
 */
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { isDecision } from './lib/rules';

/** Stored on the session: who the runs are for and how the suggested order was picked. */
export const runInfo = v.object({
	/** What the researcher typed, e.g. "P07". */
	participantLabel: v.string(),
	/** Participant number the suggested order was picked with, and the row of the counterbalancing table. */
	participantNumber: v.number(),
	orderRow: v.number()
});

/**
 * Legacy: set by the guided study flow that was replaced by the run console (a few sessions from
 * development carry it). Kept so those rows stay valid; nothing writes it any more.
 */
export const studyInfo = v.object({
	length: v.union(v.literal('quick'), v.literal('full')),
	soundCheck: v.union(v.literal('heard'), v.literal('not-heard'), v.literal('muted')),
	participantNumber: v.number(),
	orderRow: v.number(),
	numberFrom: v.union(v.literal('server'), v.literal('local')),
	finishedAt: v.optional(v.number())
});

/** Record the session's run info (idempotent). Null while the session does not exist yet, so the caller retries. */
export const setup = mutation({
	args: { sessionKey: v.string(), run: runInfo },
	handler: async (ctx, { sessionKey, run }) => {
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', sessionKey)).unique();
		if (!s) return null;
		await ctx.db.patch(s._id, { run });
		return s._id;
	}
});

/** Pauses during a run. Null while the block does not exist yet. */
export const markBlock = mutation({
	args: { blockKey: v.string(), pauses: v.optional(v.number()), pausedSeconds: v.optional(v.number()) },
	handler: async (ctx, { blockKey, ...rest }) => {
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', blockKey)).unique();
		if (!b) return null;
		const patch: Record<string, number> = {};
		for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
		await ctx.db.patch(b._id, patch);
		return b._id;
	}
});

/**
 * A run's numbers on the same definitions as the dashboard (convex/lib/rules.ts): `counted` are the
 * decisions about the end (the denominator of the rates), `wellTimed` the timely retreats among
 * them, `caught` the catches by a ghost after the end; `catches` the power-ups that ended by eating
 * the ghost (shown, but not a decision about the time left).
 */
function tally(ts: Doc<'trials'>[]) {
	const counted = ts.filter(isDecision);
	const outcomes: Record<string, number> = {};
	for (const t of ts) outcomes[t.outcome] = (outcomes[t.outcome] ?? 0) + 1;
	return {
		trials: ts.length,
		engaged: ts.filter((t) => t.engaged).length,
		counted: counted.length,
		wellTimed: counted.filter((t) => t.outcome === 'timely-retreat').length,
		caught: counted.filter((t) => t.outcome === 'caught').length,
		catches: ts.filter((t) => t.outcome === 'catch').length,
		clips: ts.filter((t) => t.clipId).length,
		outcomes
	};
}

/** The run sheet of one participant session: every run in order with its tally and rating. Null until the session exists. */
export const session = query({
	args: { sessionKey: v.string() },
	handler: async (ctx, { sessionKey }) => {
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', sessionKey)).unique();
		if (!s) return null;
		const blocks = await ctx.db.query('blocks').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
		const trials = await ctx.db.query('trials').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
		const ratings = await ctx.db.query('ratings').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
		const p = await ctx.db.get(s.participantId);
		return {
			sessionId: s._id,
			participant: p ? { number: p.number, nickname: p.nickname ?? null } : null,
			run: s.run ?? null,
			runs: blocks.map((b) => {
				const r = ratings.find((x) => x.blockId === b._id);
				return {
					key: b.key, cue: b.cue, orderIndex: b.orderIndex, mode: b.mode, startedAt: b.startedAt, endedAt: b.endedAt ?? null,
					...tally(trials.filter((t) => t.blockId === b._id)),
					clarity: r?.clarity ?? null, distraction: r?.distraction ?? null
				};
			})
		};
	}
});

/** One run for the end-of-run summary: tally, every trial (light) in order, and its rating. Null until the block exists. */
export const block = query({
	args: { blockKey: v.string() },
	handler: async (ctx, { blockKey }) => {
		const b = await ctx.db.query('blocks').withIndex('by_key', (i) => i.eq('key', blockKey)).unique();
		if (!b) return null;
		const trials = (await ctx.db.query('trials').withIndex('by_block', (i) => i.eq('blockId', b._id)).collect())
			.sort((x, y) => x.trialIndex - y.trialIndex);
		const r = await ctx.db.query('ratings').withIndex('by_block', (i) => i.eq('blockId', b._id)).first();
		return {
			blockId: b._id, cue: b.cue, mode: b.mode, orderIndex: b.orderIndex, startedAt: b.startedAt, endedAt: b.endedAt ?? null,
			deaths: b.deaths, score: b.score,
			...tally(trials),
			rows: trials.map((t) => ({
				_id: t._id, trialIndex: t.trialIndex, outcome: t.outcome, engaged: t.engaged, counted: isDecision(t), total: t.total,
				turnLeft: t.turnLeft, eats: t.eats.length, caught: t.after.caught, clipId: t.clipId ?? null
			})),
			clarity: r?.clarity ?? null, distraction: r?.distraction ?? null
		};
	}
});
