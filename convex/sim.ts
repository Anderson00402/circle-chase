/**
 * Simulated data (src/lib/sim): the shape of `sessions.sim`, and a query for what was planted.
 * A simulated session stores its preset, the planted level of every condition it played and the
 * simulated participant's traits, so the dashboard can show "planted vs recovered" side by side.
 * Planted levels are invented to validate the pipeline; they say nothing about which cue is better.
 */
import { v } from 'convex/values';
import { query } from './_generated/server';

export const simInfo = v.object({
	/** 'flat' (every condition the same) or 'planted' (declared levels per condition). */
	preset: v.string(),
	/** Groups the sessions of one simulator run. */
	run: v.string(),
	seed: v.number(),
	modelVersion: v.number(),
	/** Per condition: awareness noise (SD of the error about time left, seconds; lower is better) and mean distraction rating. */
	planted: v.array(v.object({ cue: v.string(), noise: v.number(), distraction: v.number() })),
	/** The simulated participant's traits (see src/lib/sim/model.ts). */
	profile: v.object({
		skill: v.number(),
		noiseScale: v.number(),
		caution: v.number(),
		reaction: v.number(),
		ignoreRate: v.number(),
		learning: v.number(),
		ratingBias: v.number(),
		quitAfter: v.union(v.number(), v.null())
	})
});

/**
 * Simulator runs, newest first: preset, sessions, and the planted level per condition (the same in
 * every session of a run). Only bot sessions carry `sim`.
 */
export const runs = query({
	args: {},
	handler: async (ctx) => {
		const sessions = await ctx.db.query('sessions').withIndex('by_source_started', (i) => i.eq('source', 'bot')).order('desc').collect();
		const byRun = new Map<string, {
			run: string; preset: string; modelVersion: number; startedAt: number; sessions: number; finished: number;
			planted: Map<string, { cue: string; noise: number; distraction: number }>;
		}>();
		for (const s of sessions) {
			if (!s.sim) continue;
			let r = byRun.get(s.sim.run);
			if (!r) {
				r = { run: s.sim.run, preset: s.sim.preset, modelVersion: s.sim.modelVersion, startedAt: s.startedAt, sessions: 0, finished: 0, planted: new Map() };
				byRun.set(s.sim.run, r);
			}
			r.sessions++;
			if (s.endedAt) r.finished++;
			r.startedAt = Math.min(r.startedAt, s.startedAt);
			for (const p of s.sim.planted) r.planted.set(p.cue, p);
		}
		return [...byRun.values()].map((r) => ({ ...r, planted: [...r.planted.values()] }));
	}
});
