import { v } from 'convex/values';
import { mutation, query, type MutationCtx } from './_generated/server';
import { device, source, sourceFilter } from './validators';
import { bump } from './counters';

/** Next run-console number of a source (1, 2, 3...). */
async function nextRunNumber(ctx: MutationCtx, src: 'human' | 'bot'): Promise<number> {
	const last = await ctx.db.query('participants').withIndex('by_source_runNumber', (i) => i.eq('source', src).gt('runNumber', 0)).order('desc').first();
	return (last?.runNumber ?? 0) + 1;
}

/**
 * Create the participant for this browser (or bot) or refresh it. Returns its id, its overall
 * `number` (order of first visit, shared by everyone) and, for run-console participants
 * (`console: true`), `runNumber`: 1, 2, 3... per source, counting only console participants, which
 * picks the suggested case order. A play page opened without a run never passes `console`, so it
 * uses up no run number. A participant first seen elsewhere gets its run number on the first
 * console call.
 */
export const ensure = mutation({
	args: { pid: v.string(), nickname: v.optional(v.string()), source, device, console: v.optional(v.boolean()) },
	handler: async (ctx, a) => {
		const now = Date.now();
		const old = await ctx.db.query('participants').withIndex('by_pid', (i) => i.eq('pid', a.pid)).unique();
		if (old) {
			const runNumber = old.runNumber ?? (a.console ? await nextRunNumber(ctx, old.source) : undefined);
			await ctx.db.patch(old._id, {
				lastSeen: now, device: a.device, ...(a.nickname ? { nickname: a.nickname } : {}),
				...(runNumber !== undefined && old.runNumber === undefined ? { runNumber } : {})
			});
			return { participantId: old._id, number: old.number, runNumber: runNumber ?? null };
		}
		const last = await ctx.db.query('participants').withIndex('by_number').order('desc').first();
		const number = (last?.number ?? 0) + 1;
		const runNumber = a.console ? await nextRunNumber(ctx, a.source) : undefined;
		const participantId = await ctx.db.insert('participants', {
			pid: a.pid, number, source: a.source, firstSeen: now, lastSeen: now, device: a.device,
			...(a.nickname ? { nickname: a.nickname } : {}),
			...(runNumber !== undefined ? { runNumber } : {})
		});
		await bump(ctx, a.source, { participants: 1 });
		return { participantId, number, runNumber: runNumber ?? null };
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
				_id: p._id, number: p.number, runNumber: p.runNumber ?? null, nickname: p.nickname ?? null, source: p.source,
				firstSeen: p.firstSeen, lastSeen: p.lastSeen, device: p.device,
				sessions: sessions.length,
				studySessions: sessions.filter((s) => s.mode === 'study').length,
				trials: sessions.reduce((n, s) => n + s.trials, 0)
			});
		}
		return out.sort((a, b) => b.lastSeen - a.lastSeen);
	}
});
