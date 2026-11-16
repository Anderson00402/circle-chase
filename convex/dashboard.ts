/**
 * Read queries for the results dashboard (src/routes/dashboard). Everything is aggregated here so
 * the browser receives a few kilobytes, not every trial. The exceptions are `points` (one small row
 * per decision trial for the turn-away strip plots) and `approach` (curves per condition), which the
 * page fetches only for the view that shows them.
 *
 * Speed: every query reads trial digests (convex/lib/digest.ts: one document per session with a
 * compact row per trial), never trial rows or series. The backend costs about the same per document
 * whatever its size, so a summary over 4,000 power-ups reads a few dozen digests instead of 4,000
 * rows, and stays fast when it runs again after each new power-up.
 *
 * Definitions are those of docs/STUDY.md, convex/lib/stats.ts and convex/lib/compare.ts; nothing
 * here redefines a measure. Every query takes the shared filter and defaults to human data. A
 * simulated view is read one simulator run at a time (`run`; `OTHER_RUN` is simulated play that
 * belongs to no run).
 */
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, query, type QueryCtx } from './_generated/server';
import { filterArgs, type Filter } from './lib/filters';
import { CURVE_FROM, CURVE_STEP, curveOf, rebuildSessionDigest, type DigestRow } from './lib/digest';
import { DECISIONS, isDecision, isLateCatch, RULES_VERSION } from './lib/rules';
import { decisionRates, summarize, type CueSummary, type Rate, type TrialRow } from './lib/stats';
import {
	againstRef, allPairs, cellsOf, median, peopleNeeded, pooledSd, RATE_INDEX, rateHits, type Adjusted, type RateKey
} from './lib/compare';
import { mode, sourceFilter } from './validators';

/** The `run` value for simulated play outside any simulator run. */
export const OTHER_RUN = 'other';
/** Conditions with fewer decision trials are not ranked or compared (docs/STUDY.md). */
const ENOUGH = 10;
const DECISION_SET = new Set<string>(DECISIONS);

// ---------- reading ----------

type Digest = Doc<'trialDigests'>;
/** A digest row with its session's context. */
export interface Row extends DigestRow {
	participantId: Id<'participants'>;
	sessionId: Id<'sessions'>;
	p: number | null;
	source: 'human' | 'bot';
	mode: 'study' | 'arcade';
}

/** The digests a filter needs, picked by the narrowest index. */
async function digests(ctx: QueryCtx, f: Filter): Promise<Digest[]> {
	const src = f.source ?? 'human';
	const from = f.from ?? 0, to = f.to ?? Number.MAX_SAFE_INTEGER;
	const q = ctx.db.query('trialDigests');
	const { sessionId, participantId, run } = f;
	let ds: Digest[];
	if (sessionId) ds = await q.withIndex('by_session', (i) => i.eq('sessionId', sessionId)).collect();
	else if (run && run !== OTHER_RUN) ds = await q.withIndex('by_run', (i) => i.eq('simRun', run).gte('lastAt', from)).collect();
	else if (participantId) ds = await q.withIndex('by_participant', (i) => i.eq('participantId', participantId).gte('lastAt', from)).collect();
	else if (src !== 'all') ds = await q.withIndex('by_source', (i) => i.eq('source', src).gte('lastAt', from)).collect();
	else ds = await q.collect();
	return ds.filter((d) => (src === 'all' || d.source === src)
		&& (!participantId || d.participantId === participantId)
		&& (run === OTHER_RUN ? d.source === 'bot' && !d.simRun : !run || d.simRun === run)
		&& d.lastAt >= from && d.firstAt <= to);
}

/** Rows of the filter, oldest first. */
async function readRows(ctx: QueryCtx, f: Filter): Promise<{ rows: Row[]; digests: Digest[] }> {
	const ds = await digests(ctx, f);
	const from = f.from ?? 0, to = f.to ?? Number.MAX_SAFE_INTEGER;
	const rows: Row[] = [];
	for (const d of ds) {
		for (const r of d.rows) {
			const m = r.mode ?? d.mode;
			if ((f.cue && r.cue !== f.cue) || (f.mode && m !== f.mode) || (!f.includePractice && r.practice) || r.createdAt < from || r.createdAt > to) continue;
			rows.push({ ...r, participantId: d.participantId, sessionId: d.sessionId, p: d.participantNumber, source: d.source, mode: m });
		}
	}
	rows.sort((a, b) => a.createdAt - b.createdAt);
	return { rows, digests: ds };
}

const asTrial = (r: Row): TrialRow & { rulesVersion?: number } => ({
	cue: r.cue, participantId: r.participantId, outcome: r.outcome, engaged: r.engaged, inRates: r.inRates,
	rulesVersion: r.rulesVersion ?? undefined, lateCatch: isLateCatch(r), turnLeft: r.turnLeft, wasted: r.wasted, eats: [],
	after: { nearMiss: r.nearMiss, caught: r.caught }
});
const decision = (r: Row) => isDecision({ outcome: r.outcome, inRates: r.inRates, rulesVersion: r.rulesVersion ?? undefined });

/** Block ratings of the sessions behind a filter (by session index, so only the sessions in view are read). */
async function ratingsOf(ctx: QueryCtx, f: Filter, ds: Digest[]): Promise<Doc<'ratings'>[]> {
	const out: Doc<'ratings'>[] = [];
	for (const d of ds) {
		const rs = await ctx.db.query('ratings').withIndex('by_session', (i) => i.eq('sessionId', d.sessionId)).collect();
		for (const r of rs) {
			if (r.kind !== 'block' || (f.cue && r.cue !== f.cue)) continue;
			if (r.createdAt < (f.from ?? 0) || r.createdAt > (f.to ?? Number.MAX_SAFE_INTEGER)) continue;
			out.push(r);
		}
	}
	return out;
}

// ---------- helpers ----------

/** Rates over a group of decision trials (learning curves; Wilson intervals, all conditions pooled). */
export interface Bucket {
	x: number;
	n: number;
	wellTimed: Rate;
	tooLate: Rate;
	tooEarly: Rate;
	caught: Rate;
}

function bucket(x: number, rows: Row[]): Bucket {
	const r = decisionRates(rows.map(asTrial), '', true);
	return { x, n: r.wellTimed.n, wellTimed: r.wellTimed, tooLate: r.tooLate, tooEarly: r.tooEarly, caught: r.caught };
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

const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10000) / 10000);
/** A comparison as the page needs it (fractions rounded; p-values kept). */
function slim(x: Adjusted) {
	return { a: x.a, b: x.b, people: x.people, diff: r4(x.diff), lo: r4(x.lo), hi: r4(x.hi), p: x.p, pAdj: x.pAdj, clear: x.clear };
}
export type Comparison = ReturnType<typeof slim>;

const COMPARED: RateKey[] = ['wellTimed', 'tooLate', 'tooEarly'];
/** Smallest paired difference worth detecting (fraction) in the precision statement. */
const TARGET_DIFF = 0.15;

/**
 * Breakdowns: counts of decision trials per condition and level of a factor ([n, well, late,
 * early]), so the page can show where a factor matters, and say when the data cannot tell.
 */
const FACTORS = {
	half: (r: Row) => (r.mode !== 'study' ? null : r.blockIndex < 6 ? 'Blocks 1-6' : 'Blocks 7-13'),
	power: (r: Row) => (r.total < 6 ? 'Under 6 s' : '6 s or more'),
	sound: (r: Row) => (r.sound ? 'Sound on' : 'Sound off'),
	input: (r: Row) => r.inputType || 'unknown'
} as const;
type FactorKey = keyof typeof FACTORS;

/**
 * Everything the top of the dashboard needs for one filter: totals (with what is recorded but not
 * counted, and why), per-condition headline numbers (rates over decision trials with
 * participant-clustered intervals, outcome counts, catches, turn-away spread, wasted power),
 * within-subject comparisons (paired differences against the timer bar and no signal, every pair
 * Holm-adjusted), how precise this is, breakdowns, and learning over trials and blocks.
 */
export const main = query({
	args: filterArgs,
	handler: async (ctx, f) => {
		const { rows } = await readRows(ctx, f);
		const trials = rows.map(asTrial);
		const cues = [...new Set(rows.map((r) => r.cue))].sort();
		const byCue = cues.map((c) => {
			const mine = rows.filter((r) => r.cue === c);
			const s = summarize(c, mine.map(asTrial), []);
			// Outcomes of the decision trials only: their shares are exactly the rates.
			const countedOutcomes: Record<string, number> = {};
			for (const t of mine) if (decision(t)) countedOutcomes[t.outcome] = (countedOutcomes[t.outcome] ?? 0) + 1;
			// Rules v3: early retreats that gave up on the chase very early, as a share of decision trials
			// (null when no row carries the flag, i.e. before v3).
			const flagged = mine.filter((t) => decision(t) && t.gaveUpEarly !== undefined);
			const gaveUpEarly = flagged.length ? { k: flagged.filter((t) => t.gaveUpEarly).length, n: s.decisions } : null;
			return { ...lite(s), countedOutcomes, gaveUpEarly };
		});

		// Within-subject comparisons on decision trials.
		const decisions = rows.filter(decision);
		const cells = cellsOf(decisions);
		const ranked = byCue.filter((c) => c.decisions >= ENOUGH).map((c) => c.cue);
		const versus = (ref: string) => Object.fromEntries(COMPARED.map((k) => [k, againstRef(cells, cues, ref, RATE_INDEX[k]).map(slim)])) as Record<RateKey, Comparison[]>;
		const paired = { 'timer-bar': versus('timer-bar'), none: versus('none') };
		const pairs = Object.fromEntries(COMPARED.map((k) => [k, allPairs(cells, ranked, RATE_INDEX[k]).map(slim)])) as Record<RateKey, Comparison[]>;

		// How precise: decision trials per person and condition, interval width, people needed.
		const perCell: number[] = [];
		for (const byC of cells.values()) for (const c of byC.values()) perCell.push(c.n);
		const vsTimer = againstRef(cells, cues, 'timer-bar', RATE_INDEX.wellTimed);
		const halfWidths = vsTimer.filter((x) => x.lo !== null && x.hi !== null).map((x) => (x.hi! - x.lo!) / 2);
		const sd = pooledSd(vsTimer);
		const comparisons = Math.max(1, vsTimer.length || 12);
		const precision = {
			people: cells.size,
			perPersonCondition: median(perCell),
			halfWidth: r4(median(halfWidths)),
			sd: r4(sd),
			target: TARGET_DIFF,
			comparisons,
			needed: sd !== null && sd > 0 ? peopleNeeded(sd, TARGET_DIFF, 0.05 / comparisons) : null,
			neededSingle: sd !== null && sd > 0 ? peopleNeeded(sd, TARGET_DIFF, 0.05) : null
		};

		// Breakdowns.
		const breakdowns = {} as Record<FactorKey, { levels: string[]; counts: Record<string, Record<string, [number, number, number, number]>> }>;
		for (const key of Object.keys(FACTORS) as FactorKey[]) {
			const counts: Record<string, Record<string, [number, number, number, number]>> = {};
			const levels = new Set<string>();
			for (const r of decisions) {
				const lv = FACTORS[key](r);
				if (lv === null) continue;
				levels.add(lv);
				const h = rateHits(r.outcome);
				for (const c of [r.cue, 'all']) {
					const cell = ((counts[c] ??= {})[lv] ??= [0, 0, 0, 0]);
					cell[0]++;
					cell[1] += h[0];
					cell[2] += h[1];
					cell[3] += h[3];
				}
			}
			breakdowns[key] = { levels: [...levels].sort(), counts };
		}

		// Learning: trial number within the block (1-based, last bucket pooled) and block position.
		const byTrial: Bucket[] = [];
		for (let i = 1; i <= MAX_TRIAL_BUCKET; i++) {
			byTrial.push(bucket(i, rows.filter((t) => (i < MAX_TRIAL_BUCKET ? t.trialIndex + 1 === i : t.trialIndex + 1 >= i))));
		}
		const maxBlock = rows.reduce((m, t) => Math.max(m, t.blockIndex + 1), 0);
		const byBlock: Bucket[] = [];
		for (let b = 1; b <= Math.min(maxBlock, 13); b++) byBlock.push(bucket(b, rows.filter((t) => t.blockIndex + 1 === b)));

		// What is recorded but not counted, and why: older rules, no decision about the end (by
		// outcome), or a decision the player did not stay 3 s after.
		const oldRules = rows.filter((r) => (r.rulesVersion ?? 1) !== RULES_VERSION).length;
		const notCounted: Record<string, number> = {};
		for (const r of rows) {
			if (decision(r)) continue;
			const why = (r.rulesVersion ?? 1) !== RULES_VERSION ? 'old-rules' : DECISION_SET.has(r.outcome) ? 'left-early' : r.outcome;
			notCounted[why] = (notCounted[why] ?? 0) + 1;
		}
		return {
			source: f.source ?? 'human',
			run: f.run ?? null,
			totals: {
				trials: rows.length,
				engaged: rows.filter((t) => t.engaged).length,
				inRates: trials.filter((t) => t.rulesVersion === RULES_VERSION && t.inRates).length,
				decisions: decisions.length,
				oldRules,
				notCounted,
				participants: new Set(rows.map((t) => t.participantId)).size,
				sessions: new Set(rows.map((t) => t.sessionId)).size,
				firstAt: rows.length ? rows[0].createdAt : null,
				lastAt: rows.length ? rows[rows.length - 1].createdAt : null
			},
			all: lite(summarize('all', trials, [])),
			cues: byCue,
			ranked,
			paired,
			pairs,
			precision,
			breakdowns,
			learning: { byTrial, byBlock, maxTrialBucket: MAX_TRIAL_BUCKET }
		};
	}
});

/** Questionnaire answers per condition (clarity, distraction) with 95% intervals. */
export const ratings = query({
	args: filterArgs,
	handler: async (ctx, f) => {
		const ds = await digests(ctx, f);
		const rs = await ratingsOf(ctx, f, ds);
		const cues = [...new Set(rs.map((r) => r.cue ?? '').filter(Boolean))].sort();
		const num = (xs: (number | undefined)[]) => xs.filter((x): x is number => typeof x === 'number');
		return cues.map((cue) => {
			const mine = rs.filter((r) => r.cue === cue);
			return { cue, clarity: ratingStats(num(mine.map((r) => r.clarity))), distraction: ratingStats(num(mine.map((r) => r.distraction))) };
		});
	}
});

/**
 * One small row per decision trial (turn-away time, or "never turned" when the last chase was still
 * running), and per early retreat its wasted power, for strip plots where every trial is a point you
 * can hover and open as a replay.
 */
export const points = query({
	args: filterArgs,
	handler: async (ctx, f) => {
		const { rows } = await readRows(ctx, f);
		return rows.filter((r) => decision(r) || r.wasted !== null).map((r) => ({
			id: r.id,
			cue: r.cue,
			outcome: r.outcome,
			inRates: decision(r),
			turnLeft: decision(r) ? r.turnLeft : null,
			wasted: r.wasted,
			total: r.total,
			p: r.p,
			trialIndex: r.trialIndex,
			at: r.createdAt,
			clip: r.clip
		}));
	}
});

/** Plotted window of the approach curves: from 4 s left (every study power-up lasts at least 4 s) to 3 s after the end. */
const APPROACH_FROM = 4, APPROACH_TO = -3;

/**
 * Approach curves (STUDY.md "Series") for decision trials whose power lasted at least as long as
 * the plotted window, so every point of a curve rests on the same power-ups and the mix of power
 * lengths cannot bend it. Per condition and time left: the share still chasing (with a Wilson
 * interval) and the median path distance to the nearest scared ghost (after the end: to the ghosts
 * that were scared when it ran out).
 */
export const approach = query({
	args: filterArgs,
	handler: async (ctx, f) => {
		const { rows } = await readRows(ctx, f);
		const k0 = Math.round((CURVE_FROM - APPROACH_FROM) / CURVE_STEP);
		const k1 = Math.round((CURVE_FROM - APPROACH_TO) / CURVE_STEP);
		const bins: number[] = [];
		for (let k = k0; k <= k1; k++) bins.push(Math.round((CURVE_FROM - k * CURVE_STEP) * 100) / 100);
		const dec = rows.filter(decision);
		const short = dec.filter((r) => r.total < APPROACH_FROM - 1e-6).length;
		const curves = new Map(dec.map((r) => [r.id, curveOf(r)]));
		const missing = dec.filter((r) => r.total >= APPROACH_FROM - 1e-6 && !curves.get(r.id)).length;
		const acc = new Map<string, { n: number; people: Set<string>; c: number[]; cN: number[]; d: number[][] }>();
		for (const r of dec) {
			const cv = curves.get(r.id);
			if (r.total < APPROACH_FROM - 1e-6 || !cv) continue;
			let a = acc.get(r.cue);
			if (!a) acc.set(r.cue, (a = { n: 0, people: new Set(), c: bins.map(() => 0), cN: bins.map(() => 0), d: bins.map(() => []) }));
			a.n++;
			a.people.add(r.participantId);
			for (let k = k0; k <= k1; k++) {
				const i = k - k0;
				if (cv.chasing[k] >= 0) {
					a.cN[i]++;
					a.c[i] += cv.chasing[k];
				}
				if (cv.dist[k] >= 0) a.d[i].push(cv.dist[k] / 10);
			}
		}
		const r2 = (x: number) => Math.round(x * 1000) / 1000;
		const wil = (k: number, n: number) => {
			if (!n) return [null, null] as const;
			const z = 1.96, p = k / n, den = 1 + (z * z) / n;
			const mid = (p + (z * z) / (2 * n)) / den, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
			return [r2(Math.max(0, mid - half)), r2(Math.min(1, mid + half))] as const;
		};
		return {
			bins,
			window: { from: APPROACH_FROM, to: APPROACH_TO },
			excluded: { short, missing },
			cues: [...acc.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cue, a]) => ({
				cue,
				trials: a.n,
				people: a.people.size,
				chasing: a.c.map((s, i) => (a.cN[i] ? r2(s / a.cN[i]) : null)),
				chasingLo: a.c.map((s, i) => wil(s, a.cN[i])[0]),
				chasingHi: a.c.map((s, i) => wil(s, a.cN[i])[1]),
				chasingN: a.cN,
				dist: a.d.map((xs) => (xs.length ? r2(median(xs)!) : null)),
				distN: a.d.map((xs) => xs.length)
			}))
		};
	}
});

/** The newest trials of a filter (a live feed), with participant numbers and replay availability. */
export const recent = query({
	args: { ...filterArgs, limit: v.optional(v.number()) },
	handler: async (ctx, { limit = 25, ...f }) => {
		const ds = await digests(ctx, f);
		// Only the newest digests can hold the newest trials.
		ds.sort((a, b) => b.lastAt - a.lastAt);
		const n = Math.min(limit, 200);
		const out: Row[] = [];
		for (const d of ds) {
			if (out.length >= n && d.lastAt < out[out.length - 1].createdAt) break;
			for (const r of d.rows) {
				const m = r.mode ?? d.mode;
				if ((f.cue && r.cue !== f.cue) || (f.mode && m !== f.mode) || (!f.includePractice && r.practice)) continue;
				if (r.createdAt < (f.from ?? 0) || r.createdAt > (f.to ?? Number.MAX_SAFE_INTEGER)) continue;
				out.push({ ...r, participantId: d.participantId, sessionId: d.sessionId, p: d.participantNumber, source: d.source, mode: m });
			}
			out.sort((a, b) => b.createdAt - a.createdAt);
			out.length = Math.min(out.length, n);
		}
		return out.map((r) => ({
			id: r.id,
			at: r.createdAt,
			cue: r.cue,
			mode: r.mode,
			source: r.source,
			outcome: r.outcome,
			engaged: r.engaged,
			inRates: decision(r),
			oldRules: (r.rulesVersion ?? 1) !== RULES_VERSION,
			total: r.total,
			turnLeft: r.turnLeft,
			wasted: r.wasted,
			caught: r.caught,
			trialIndex: r.trialIndex,
			blockIndex: r.blockIndex,
			fps: r.fps,
			p: r.p,
			clip: r.clip
		}));
	}
});

/**
 * Sessions with data-quality columns (frame rate, sound, input, completion) for the participants
 * view. Trial columns come from the session's digest; questionnaire counts from its ratings.
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
			&& (f.run === OTHER_RUN ? s.source === 'bot' && !s.sim : !f.run || s.sim?.run === f.run)
			&& (s.lastActiveAt ?? s.startedAt) >= (f.from ?? 0) && s.startedAt <= (f.to ?? Number.MAX_SAFE_INTEGER)
			&& s.trials > 0).slice(0, 100);
		const out = [];
		for (const s of rows) {
			const d = await ctx.db.query('trialDigests').withIndex('by_session', (i) => i.eq('sessionId', s._id)).unique();
			const trials = (d?.rows ?? []).filter((t) => !t.practice);
			const fps = trials.map((t) => t.fps).filter((x) => x > 0);
			const ratings = await ctx.db.query('ratings').withIndex('by_session', (i) => i.eq('sessionId', s._id)).collect();
			const firstWithClip = trials.find((t) => t.clip);
			out.push({
				id: s._id,
				p: d?.participantNumber ?? (await ctx.db.get(s.participantId))?.number ?? null,
				participantId: s.participantId,
				label: s.run?.participantLabel ?? null,
				mode: s.mode,
				source: s.source,
				startedAt: s.startedAt,
				lastActiveAt: s.lastActiveAt,
				endedAt: s.endedAt ?? null,
				planned: s.cueOrder.length,
				blocksPlayed: new Set(trials.map((t) => t.blockIndex)).size,
				trials: trials.length,
				engaged: trials.filter((t) => t.engaged).length,
				inRates: trials.filter((t) => isDecision({ outcome: t.outcome, inRates: t.inRates, rulesVersion: t.rulesVersion ?? undefined })).length,
				clips: trials.filter((t) => t.clip).length,
				firstClip: firstWithClip?.id ?? null,
				fpsMean: fps.length ? Math.round(fps.reduce((a, b) => a + b, 0) / fps.length) : null,
				fpsMin: fps.length ? Math.round(Math.min(...fps)) : null,
				lowFps: fps.filter((x) => x < 50).length,
				sound: s.sound,
				reducedMotion: s.reducedMotion,
				inputType: s.inputType,
				appVersion: s.appVersion,
				blockRatings: ratings.filter((r) => r.kind === 'block').length,
				finalRating: ratings.some((r) => r.kind === 'session'),
				sim: s.sim ? { preset: s.sim.preset, run: s.sim.run } : null
			});
		}
		return out;
	}
});

/**
 * What the filter controls offer: trial counts per source and mode (from the session counters, so
 * this stays cheap), the participants that have trials, and the simulator runs (newest first). A
 * run counts as complete once nothing has been written to it for two minutes: simulated players
 * may quit early on purpose, and the planned size is not stored, so "still being written" is the
 * only sure sign of an unfinished run. `now` (ms) comes from the page so the query stays cached.
 */
export const facets = query({
	args: { source: v.optional(sourceFilter), mode: v.optional(mode), run: v.optional(v.string()), now: v.optional(v.number()) },
	handler: async (ctx, a) => {
		const sessions = await ctx.db.query('sessions').collect();
		const counts = { human: { study: 0, arcade: 0 }, bot: { study: 0, arcade: 0 } };
		const perParticipant = new Map<string, number>();
		const runs = new Map<string, { run: string; preset: string; sessions: number; trials: number; startedAt: number; lastAt: number; complete: boolean }>();
		const other = { sessions: 0, trials: 0, lastAt: 0 };
		for (const s of sessions) {
			counts[s.source][s.mode] += s.trials;
			if (s.source === 'bot' && s.trials > 0) {
				if (s.sim) {
					const r = runs.get(s.sim.run) ?? { run: s.sim.run, preset: s.sim.preset, sessions: 0, trials: 0, startedAt: s.startedAt, lastAt: 0, complete: true };
					r.sessions++;
					r.trials += s.trials;
					r.startedAt = Math.min(r.startedAt, s.startedAt);
					r.lastAt = Math.max(r.lastAt, s.lastActiveAt);
					runs.set(s.sim.run, r);
				} else {
					other.sessions++;
					other.trials += s.trials;
					other.lastAt = Math.max(other.lastAt, s.lastActiveAt);
				}
			}
			const src = a.source ?? 'human';
			const inRun = src !== 'human' && a.run ? (a.run === OTHER_RUN ? !s.sim : s.sim?.run === a.run) : true;
			if ((src === 'all' || s.source === src) && (!a.mode || s.mode === a.mode) && s.trials > 0 && inRun)
				perParticipant.set(s.participantId, (perParticipant.get(s.participantId) ?? 0) + s.trials);
		}
		const participants = [];
		for (const [id, trials] of perParticipant) {
			const p = await ctx.db.get(id as Id<'participants'>);
			if (p) participants.push({ id: p._id, number: p.number, nickname: p.nickname ?? null, source: p.source, trials });
		}
		participants.sort((x, y) => x.number - y.number);
		const now = a.now ?? Date.now();
		for (const r of runs.values()) r.complete = now - r.lastAt > 120_000;
		return { counts, participants, runs: [...runs.values()].sort((x, y) => y.startedAt - x.startedAt), other };
	}
});

/** Spearman rank correlation (average ranks for ties); null below 3 pairs. */
function spearman(xs: number[], ys: number[]): number | null {
	if (xs.length < 3) return null;
	const rank = (a: number[]) => {
		const idx = a.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
		const r = new Array<number>(a.length);
		for (let k = 0; k < idx.length;) {
			let j = k;
			while (j + 1 < idx.length && idx[j + 1].v === idx[k].v) j++;
			for (let m = k; m <= j; m++) r[idx[m].i] = (k + j) / 2 + 1;
			k = j + 1;
		}
		return r;
	};
	const rx = rank(xs), ry = rank(ys);
	const mx = rx.reduce((a, b) => a + b, 0) / rx.length, my = ry.reduce((a, b) => a + b, 0) / ry.length;
	let num = 0, dx = 0, dy = 0;
	for (let i = 0; i < rx.length; i++) {
		num += (rx[i] - mx) * (ry[i] - my);
		dx += (rx[i] - mx) ** 2;
		dy += (ry[i] - my) ** 2;
	}
	return dx && dy ? Math.round((num / Math.sqrt(dx * dy)) * 100) / 100 : null;
}

/**
 * Planted vs recovered, for one simulator run. For every condition: the awareness noise and
 * distraction the simulator planted (convex/sim.ts), and what the real pipeline measured from the
 * bots' play. If the instrument works, the well-timed rate falls as planted noise rises (a negative
 * rank correlation), the too-late and too-early rates rise with it, and the flat preset shows no
 * clear differences.
 */
export const simCheck = query({
	args: { run: v.string() },
	handler: async (ctx, a) => {
		const sessions = (await ctx.db.query('sessions').withIndex('by_source_started', (i) => i.eq('source', 'bot')).collect())
			.filter((s) => s.sim?.run === a.run);
		if (!sessions.length) return null;
		const planted = new Map<string, { noise: number; distraction: number }>();
		for (const s of sessions) for (const p of s.sim!.planted) planted.set(p.cue, { noise: p.noise, distraction: p.distraction });
		const f: Filter = { source: 'bot', run: a.run };
		const { rows, digests: ds } = await readRows(ctx, f);
		const ratings = await ratingsOf(ctx, f, ds);
		const cues = [...planted.entries()].map(([cue, p]) => {
			const rs = ratings.filter((r) => r.cue === cue);
			const sm = summarize(cue, rows.filter((t) => t.cue === cue).map(asTrial), rs);
			return {
				cue, plantedNoise: p.noise, plantedDistraction: p.distraction,
				inRates: sm.decisions, trials: sm.trials, participants: sm.decisionParticipants, interval: sm.interval,
				wellTimed: sm.wellTimed, tooLate: sm.tooLate, tooEarly: sm.tooEarly, caught: sm.caught, catches: sm.catches,
				turnMedian: sm.turnAway.median, distraction: sm.distraction, clarity: sm.clarity
			};
		}).sort((x, y) => x.plantedNoise - y.plantedNoise || x.cue.localeCompare(y.cue));
		const ok = cues.filter((c) => c.wellTimed.rate !== null);
		const rhoOf = (get: (c: (typeof ok)[number]) => number | null) => spearman(ok.map((c) => c.plantedNoise), ok.map((c) => get(c) ?? 0));
		return {
			run: a.run,
			preset: sessions[0].sim!.preset,
			cues,
			rhos: {
				wellTimed: rhoOf((c) => c.wellTimed.rate),
				tooLate: rhoOf((c) => c.tooLate.rate),
				tooEarly: rhoOf((c) => c.tooEarly.rate),
				caught: rhoOf((c) => c.caught.rate),
				turnMedian: rhoOf((c) => c.turnMedian),
				clarity: rhoOf((c) => c.clarity.mean)
			},
			trials: rows.length,
			participants: new Set(rows.map((t) => t.participantId)).size
		};
	}
});

/**
 * Rebuild the trial digests from the trial rows, a page of sessions at a time (run it until
 * `isDone`): `npx convex run dashboard:rebuildDigests '{"cursor": null}'`. Only writes digests.
 */
export const rebuildDigests = internalMutation({
	args: { cursor: v.union(v.string(), v.null()), batch: v.optional(v.number()) },
	handler: async (ctx, { cursor, batch = 4 }) => {
		const page = await ctx.db.query('sessions').paginate({ cursor, numItems: batch });
		let rows = 0;
		for (const s of page.page) rows += await rebuildSessionDigest(ctx, s._id);
		return { cursor: page.continueCursor, isDone: page.isDone, sessions: page.page.length, rows };
	}
});

export type { Filter };
