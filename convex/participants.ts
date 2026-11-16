import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { device, source, sourceFilter } from './validators';

/** Create the participant for this browser (or bot) or refresh it. Returns its id and number. */
export const ensure = mutation({
	args: { pid: v.string(), nickname: v.optional(v.string()), source, device },
	handler: async (ctx, a) => {
		const now = Date.now();
		const old = await ctx.db.query('participants').withIndex('by_pid', (i) => i.eq('pid', a.pid)).unique();
		if (old) {
			await ctx.db.patch(old._id, { lastSeen: now, device: a.device, ...(a.nickname ? { nickname: a.nickname } : {}) });
			return { participantId: old._id, number: old.number };
		}
		const last = await ctx.db.query('participants').withIndex('by_number').order('desc').first();
		const number = (last?.number ?? 0) + 1;
		const participantId = await ctx.db.insert('participants', {
			pid: a.pid, number, source: a.source, firstSeen: now, lastSeen: now, device: a.device,
			...(a.nickname ? { nickname: a.nickname } : {})
		});
		return { participantId, number };
	}
});

/** Participants with how much they played, newest first. */
export const overview = query({
	args: { source: v.optional(sourceFilter) },
	handler: async (ctx, { source: src = 'human' }) => {
		const people = src === 'all'
			? await ctx.db.query('participants').collect()
			: await ctx.db.query('participants').withIndex('by_source', (i) => i.eq('source', src)).collect();
		const out = [];
		for (const p of people) {
			const sessions = await ctx.db.query('sessions').withIndex('by_participant', (i) => i.eq('participantId', p._id)).collect();
			out.push({
				_id: p._id, number: p.number, nickname: p.nickname ?? null, source: p.source,
				firstSeen: p.firstSeen, lastSeen: p.lastSeen, device: p.device,
				sessions: sessions.length,
				studySessions: sessions.filter((s) => s.mode === 'study').length,
				trials: sessions.reduce((n, s) => n + s.trials, 0)
			});
		}
		return out.sort((a, b) => b.lastSeen - a.lastSeen);
	}
});
