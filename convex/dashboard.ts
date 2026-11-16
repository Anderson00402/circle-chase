/**
 * Read queries for the results dashboard (src/routes/dashboard). Everything is aggregated here so
 * the browser receives a few kilobytes, not every trial. The exceptions are `points` (one small row
 * per trial for the turn-away strip plots) and `approach` (series averaged per condition), which the
 * page fetches only for the view that shows them.
 *
 * Definitions are those of docs/STUDY.md and convex/lib/stats.ts; nothing here redefines a measure.
 * Every query takes the shared filter and defaults to human data.
 */
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import { filterArgs, scanTrials, type Filter } from './lib/filters';
import { unpackSeries } from './lib/series';
import { summarize, wilson, type CueSummary, type Rate } from './lib/stats';
import { blockRatings } from './summary';
import { mode, sourceFilter } from './validators';

/** A rate over a group of trials that count toward the rates. */
export interface Bucket {
	x: number;
	n: number;
	wellTimed: Rate;
	caught: Rate;
}

function bucket(x: number, rows: Doc<'trials'>[]): Bucket {
	const counted = rows.filter((t) => t.inRates);
	const caught = counted.filter((t) => t.outcome === 'caught').length;
	const well = counted.filter((t) => t.outcome === 'late-catch' || t.outcome === 'timely-retreat').length;
	return { x, n: counted.length, wellTimed: wilson(well, counted.length), caught: wilson(caught, counted.length) };
}

/** Mean and 95% interval (normal approximation) of 1-7 ratings. */
function ratingStats(xs: number[]) {
	const n = xs.length;
	if (!n) return { n, mean: null, lo: null, hi: null };
	const mean = xs.reduce((a, b) => a + b, 0) / n;
	const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
	const half = n > 1 ? (1.96 * sd) / Math.sqrt(n) : 0;
	const r = (x: number) => Math.round(x * 100) / 100;
	return { n, mean: r(mean), lo: r(Math.max(1, mean - half)), hi: r(Math.min(7, mean + half)) };
}

/** A summary without the per-trial value lists (the strip plots fetch those through `points`). */
function lite(s: CueSummary) {
	return { ...s, turnAway: { ...s.turnAway, values: [] as number[] }, wasted: { ...s.wasted, values: [] as number[] } };
}

/** Learning curves are cut at this many trials in a block; later trials are pooled into the last bucket. */
const MAX_TRIAL_BUCKET = 8;

/**
 * Everything the top of the dashboard needs for one filter: totals, per-condition headline numbers
 * (rates with Wilson intervals, outcome counts, turn-away spread, wasted power, ratings with their
 * intervals), learning over trial number within a block and over block position in the session.
 */
export const main = query({
	args: filterArgs,
	handler: async (ctx, f) => {
		const trials = await scanTrials(ctx, f);
		const ratings = await blockRatings(ctx, f);
		const cues = [...new Set([...trials.map((t) => t.cue), ...ratings.map((r) => r.cue ?? '')].filter(Boolean))].sort();
		const byCue = cues.map((c) => {
			const rs = ratings.filter((r) => r.cue === c);
			const s = summarize(c, trials.filter((t) => t.cue === c), rs);
			return {
				...lite(s),
				clarityCI: ratingStats(rs.map((r) => r.clarity).filter((x): x is number => typeof x === 'number')),
				distractionCI: ratingStats(rs.map((r) => r.distraction).filter((x): x is number => typeof x === 'number'))
			};
		});

		// Learning: trial number within the block (1-based, last bucket pooled) and block position.
		const byTrial: Bucket[] = [];
		for (let i = 1; i <= MAX_TRIAL_BUCKET; i++) {
			const rows = trials.filter((t) => (i < MAX_TRIAL_BUCKET ? t.trialIndex + 1 === i : t.trialIndex + 1 >= i));
			byTrial.push(bucket(i, rows));
		}
		const maxBlock = trials.reduce((m, t) => Math.max(m, t.blockIndex + 1), 0);
		const byBlock: Bucket[] = [];
		for (let b = 1; b <= Math.min(maxBlock, 13); b++) byBlock.push(bucket(b, trials.filter((t) => t.blockIndex + 1 === b)));

		const sessions = new Set(trials.map((t) => t.sessionId));
		return {
			source: f.source ?? 'human',
			totals: {
				trials: trials.length,
				engaged: trials.filter((t) => t.engaged).length,
				inRates: trials.filter((t) => t.inRates).length,
				participants: new Set(trials.map((t) => t.participantId)).size,
				sessions: sessions.size,
				ratings: ratings.length,
				firstAt: trials.length ? trials[0].createdAt : null,
				lastAt: trials.length ? trials[trials.length - 1].createdAt : null
			},
			all: lite(summarize('all', trials, ratings)),
			cues: byCue,
			learning: { byTrial, byBlock, maxTrialBucket: MAX_TRIAL_BUCKET }
		};
	}
});

async function participantNumbers(ctx: QueryCtx, ids: Iterable<Id<'participants'>>) {
	const out = new Map<string, { number: number; nickname: string | null }>();
	for (const id of new Set(ids)) {
		const p = await ctx.db.get(id);
		if (p) out.set(id, { number: p.number, nickname: p.nickname ?? null });
	}
	return out;
}

/**
 * One small row per trial that has a turn-away time or wasted power, for strip plots where every
 * trial is a point you can hover and open as a replay.
 */
export const points = query({
	args: filterArgs,
	handler: async (ctx, f) => {
		const trials = (await scanTrials(ctx, f)).filter((t) => (t.inRates && t.turnLeft !== null) || t.wasted !== null);
		const people = await participantNumbers(ctx, trials.map((t) => t.participantId));
		return trials.map((t) => ({
			id: t._id,
			cue: t.cue,
			outcome: t.outcome,
			inRates: t.inRates,
			turnLeft: t.inRates ? t.turnLeft : null,
			wasted: t.wasted,
			total: t.total,
			p: people.get(t.participantId)?.number ?? null,
			trialIndex: t.trialIndex,
			at: t.createdAt,
			clip: !!t.clipId
		}));
	}
});

/** Time-left grid of the approach curves: 6 s before the end to 3 s after, in 0.25 s steps. */
const GRID_FROM = 6, GRID_TO = -3, GRID_STEP = 0.25;

/**
 * Approach curves (STUDY.md "Series"): for each condition, the mean path distance to the nearest
 * scared ghost (after the end: to the ghosts that were scared when it ran out) and the share of
 * trials still chasing, against time left on the power. Only trials that count toward the rates.
 */
export const approach = query({
	args: filterArgs,
	handler: async (ctx, f) => {
		const trials = (await scanTrials(ctx, f)).filter((t) => t.inRates);
		const bins: number[] = [];
		for (let x = GRID_FROM; x >= GRID_TO - 1e-9; x -= GRID_STEP) bins.push(Math.round(x * 100) / 100);
		const idx = (left: number) => Math.round((GRID_FROM - left) / GRID_STEP);
		const acc = new Map<string, { trials: number; dSum: number[]; dN: number[]; cSum: number[]; cN: number[] }>();
		for (const t of trials) {
			let a = acc.get(t.cue);
			if (!a) {
				a = { trials: 0, dSum: bins.map(() => 0), dN: bins.map(() => 0), cSum: bins.map(() => 0), cN: bins.map(() => 0) };
				acc.set(t.cue, a);
			}
			a.trials++;
			const s = unpackSeries(t.series);
			// One value per trial and bin: the sample nearest the bin centre.
			const seen = new Set<number>();
			for (let i = 0; i < s.t.length; i++) {
				const k = idx(s.left[i]);
				if (k < 0 || k >= bins.length || seen.has(k)) continue;
				seen.add(k);
				const d = s.dist[i];
				if (d !== null) {
					a.dSum[k] += d;
					a.dN[k]++;
				}
				a.cSum[k] += s.chasing[i] ? 1 : 0;
				a.cN[k]++;
			}
		}
		const r2 = (x: number) => Math.round(x * 100) / 100;
		return {
			bins,
			cues: [...acc.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cue, a]) => ({
				cue,
				trials: a.trials,
				dist: a.dSum.map((s, i) => (a.dN[i] ? r2(s / a.dN[i]) : null)),
				distN: a.dN,
				chasing: a.cSum.map((s, i) => (a.cN[i] ? r2(s / a.cN[i]) : null)),
				chasingN: a.cN
			}))
		};
	}
});

/** The newest trials of a filter (a live feed), with participant numbers and replay availability. */
export const recent = query({
	args: { ...filterArgs, limit: v.optional(v.number()) },
	handler: async (ctx, { limit = 25, ...f }) => {
		const src = f.source ?? 'human';
		const t = ctx.db.query('trials');
		const base = f.participantId
			? t.withIndex('by_participant', (i) => i.eq('participantId', f.participantId!))
			: src !== 'all' && f.cue
				? t.withIndex('by_source_cue', (i) => i.eq('source', src).eq('cue', f.cue!))
				: src !== 'all'
					? t.withIndex('by_source_created', (i) => i.eq('source', src))
					: t.withIndex('by_created');
		const rows: Doc<'trials'>[] = [];
		for await (const r of base.order('desc')) {
			if ((src === 'all' || r.source === src) && (!f.mode || r.mode === f.mode) && (!f.cue || r.cue === f.cue)
				&& (!f.sessionId || r.sessionId === f.sessionId)
				&& r.createdAt >= (f.from ?? 0) && r.createdAt <= (f.to ?? Number.MAX_SAFE_INTEGER)) rows.push(r);
			if (rows.length >= Math.min(limit, 200)) break;
		}
		const people = await participantNumbers(ctx, rows.map((r) => r.participantId));
		return rows.map((r) => ({
			id: r._id,
			at: r.createdAt,
			cue: r.cue,
			mode: r.mode,
			source: r.source,
			outcome: r.outcome,
			engaged: r.engaged,
			inRates: r.inRates,
			total: r.total,
			turnLeft: r.turnLeft,
			wasted: r.wasted,
			eats: r.eats.length,
			caught: r.after.caught,
			trialIndex: r.trialIndex,
			blockIndex: r.blockIndex,
			fps: r.fps,
			p: people.get(r.participantId)?.number ?? null,
			nickname: people.get(r.participantId)?.nickname ?? null,
			clip: !!r.clipId
		}));
	}
});

/**
 * Sessions with data-quality columns (frame rate, sound, input, completion) for the participants
 * view. Frame rate and engaged counts come from the session's trials.
 */
export const sessions = query({
	args: filterArgs,
	handler: async (ctx, f) => {
		const src = f.source ?? 'human';
		const q = f.participantId
			? ctx.db.query('sessions').withIndex('by_participant', (i) => i.eq('participantId', f.participantId!))
			: src === 'all'
				? ctx.db.query('sessions').withIndex('by_started')
				: ctx.db.query('sessions').withIndex('by_source_started', (i) => i.eq('source', src));
		const rows = (await q.order('desc').take(400)).filter((s) => (src === 'all' || s.source === src)
			&& (!f.mode || s.mode === f.mode)
			&& s.startedAt >= (f.from ?? 0) && s.startedAt <= (f.to ?? Number.MAX_SAFE_INTEGER)
			&& s.trials > 0).slice(0, 100);
		const people = await participantNumbers(ctx, rows.map((s) => s.participantId));
		const out = [];
		for (const s of rows) {
			const blocks = await ctx.db.query('blocks').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
			const trials = await ctx.db.query('trials').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
			const fps = trials.map((t) => t.fps).filter((x) => x > 0);
			const ratings = await ctx.db.query('ratings').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
			out.push({
				id: s._id,
				p: people.get(s.participantId)?.number ?? null,
				nickname: people.get(s.participantId)?.nickname ?? null,
				participantId: s.participantId,
				mode: s.mode,
				source: s.source,
				startedAt: s.startedAt,
				lastActiveAt: s.lastActiveAt,
				endedAt: s.endedAt ?? null,
				planned: s.cueOrder.length,
				blocksPlayed: blocks.filter((b) => b.trialCount > 0).length,
				trials: trials.length,
				engaged: trials.filter((t) => t.engaged).length,
				inRates: trials.filter((t) => t.inRates).length,
				fpsMean: fps.length ? Math.round(fps.reduce((a, b) => a + b, 0) / fps.length) : null,
				fpsMin: fps.length ? Math.round(Math.min(...fps)) : null,
				lowFps: fps.filter((x) => x < 50).length,
				sound: s.sound,
				reducedMotion: s.reducedMotion,
				inputType: s.inputType,
				viewport: s.viewport,
				appVersion: s.appVersion,
				blockRatings: ratings.filter((r) => r.kind === 'block').length,
				finalRating: ratings.some((r) => r.kind === 'session'),
				sim: (s as unknown as { sim?: unknown }).sim ?? null
			});
		}
		return out;
	}
});

/**
 * What the filter controls offer: trial counts per source and mode (from the session counters, so
 * this stays cheap) and the participants that have trials.
 */
export const facets = query({
	args: { source: v.optional(sourceFilter), mode: v.optional(mode) },
	handler: async (ctx, a) => {
		const sessions = await ctx.db.query('sessions').collect();
		const counts = { human: { study: 0, arcade: 0 }, bot: { study: 0, arcade: 0 } };
		const perParticipant = new Map<string, number>();
		for (const s of sessions) {
			counts[s.source][s.mode] += s.trials;
			const src = a.source ?? 'human';
			if ((src === 'all' || s.source === src) && (!a.mode || s.mode === a.mode) && s.trials > 0)
				perParticipant.set(s.participantId, (perParticipant.get(s.participantId) ?? 0) + s.trials);
		}
		const participants = [];
		for (const [id, trials] of perParticipant) {
			const p = await ctx.db.get(id as Id<'participants'>);
			if (p) participants.push({ id: p._id, number: p.number, nickname: p.nickname ?? null, source: p.source, trials });
		}
		participants.sort((x, y) => x.number - y.number);
		return { counts, participants };
	}
});

export type { Filter };
