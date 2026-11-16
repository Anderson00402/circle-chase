import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { inputType, mode, source, sourceFilter, viewport } from './validators';

/** Open a session (idempotent by `key`). The participant must exist (`participants:ensure`). */
export const start = mutation({
	args: {
		key: v.string(), pid: v.string(), mode, source, cueOrder: v.array(v.string()), appVersion: v.string(),
		difficulty: v.string(), sound: v.boolean(), reducedMotion: v.boolean(), inputType, viewport
	},
	handler: async (ctx, a) => {
		const old = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', a.key)).unique();
		if (old) return { sessionId: old._id };
		const p = await ctx.db.query('participants').withIndex('by_pid', (i) => i.eq('pid', a.pid)).unique();
		if (!p) throw new Error('unknown participant; call participants:ensure first');
		const now = Date.now();
		const sessionId = await ctx.db.insert('sessions', {
			...a, participantId: p._id, startedAt: now, lastActiveAt: now, blocks: 0, trials: 0
		});
		return { sessionId };
	}
});

/** Update what changed during the session (input type seen, sound toggled) and/or close it. */
export const update = mutation({
	args: {
		key: v.string(), inputType: v.optional(inputType), sound: v.optional(v.boolean()),
		reducedMotion: v.optional(v.boolean()), end: v.optional(v.boolean())
	},
	handler: async (ctx, { key, end, ...rest }) => {
		const s = await ctx.db.query('sessions').withIndex('by_key', (i) => i.eq('key', key)).unique();
		if (!s) return null;
		const now = Date.now();
		const patch: Record<string, unknown> = { lastActiveAt: now };
		for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
		if (end) patch.endedAt = now;
		await ctx.db.patch(s._id, patch);
		return s._id;
	}
});

/** Sessions, newest first, with their participant and blocks. */
export const overview = query({
	args: { source: v.optional(sourceFilter), mode: v.optional(mode), limit: v.optional(v.number()) },
	handler: async (ctx, { source: src = 'human', mode: m, limit = 50 }) => {
		const q = src === 'all'
			? ctx.db.query('sessions').withIndex('by_started').order('desc')
			: ctx.db.query('sessions').withIndex('by_source_started', (i) => i.eq('source', src)).order('desc');
		const sessions = (await q.take(Math.min(limit * 4, 1000))).filter((s) => !m || s.mode === m).slice(0, limit);
		const out = [];
		for (const s of sessions) {
			const p = await ctx.db.get(s.participantId);
			const blocks = await ctx.db.query('blocks').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
			out.push({
				_id: s._id, key: s.key, mode: s.mode, source: s.source, startedAt: s.startedAt, endedAt: s.endedAt ?? null,
				lastActiveAt: s.lastActiveAt, appVersion: s.appVersion, difficulty: s.difficulty, inputType: s.inputType,
				sound: s.sound, reducedMotion: s.reducedMotion, viewport: s.viewport, cueOrder: s.cueOrder, trials: s.trials,
				participant: p ? { _id: p._id, number: p.number, nickname: p.nickname ?? null } : null,
				blocks: blocks.map((b) => ({
					_id: b._id, cue: b.cue, orderIndex: b.orderIndex, startedAt: b.startedAt, endedAt: b.endedAt ?? null,
					trialCount: b.trialCount, engagedCount: b.engagedCount, deaths: b.deaths, score: b.score
				}))
			});
		}
		return out;
	}
});
