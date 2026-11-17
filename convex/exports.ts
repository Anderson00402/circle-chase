/**
 * Exports: trials (CSV or JSON), ratings (CSV) and blocks, i.e. runs (CSV). Every export is read in
 * pages (`exports.page`), so it works at any size: one page stays far below Convex's 16 MiB return
 * limit, and the HTTP routes (convex/http.ts) stream page after page into one download.
 *
 * Context that lives on other rows (participant label and numbers, the Latin square row, pauses,
 * the session's app version and simulator run) is joined in per page.
 */
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import { filterArgs, light, matches, trialRange, type Filter } from './lib/filters';
import { isDecision, isLateCatch } from './lib/rules';
import { unpackSeries } from './lib/series';
import { packedSeriesOf } from './trials';

/** Rows per page by default; the HTTP routes accept `pageSize` (1-1000) to force smaller pages. */
export const PAGE_SIZE = { trials: 400, trialsJson: 200, ratings: 1000, blocks: 500 } as const;

export const kind = v.union(v.literal('trials'), v.literal('ratings'), v.literal('blocks'));
export type Kind = 'trials' | 'ratings' | 'blocks';
export const format = v.union(v.literal('csv'), v.literal('json'));

/** Rows joined in for context, looked up once per page. */
class Joins {
	private sessions = new Map<string, Doc<'sessions'> | null>();
	private participants = new Map<string, Doc<'participants'> | null>();
	private blocks = new Map<string, Doc<'blocks'> | null>();
	constructor(private ctx: QueryCtx) {}
	private async get<T>(map: Map<string, T | null>, id: string, load: () => Promise<T | null>): Promise<T | null> {
		if (!map.has(id)) map.set(id, await load());
		return map.get(id) ?? null;
	}
	session(id: Id<'sessions'>) { return this.get(this.sessions, id, () => this.ctx.db.get(id)); }
	participant(id: Id<'participants'>) { return this.get(this.participants, id, () => this.ctx.db.get(id)); }
	block(id: Id<'blocks'>) { return this.get(this.blocks, id, () => this.ctx.db.get(id)); }
}

/** Who and in which run: the same columns at the start of every export. */
function who(s: Doc<'sessions'> | null, p: Doc<'participants'> | null) {
	return {
		participantLabel: s?.run?.participantLabel ?? p?.nickname ?? null,
		/** Overall order of first visit (everyone, also free play and bots). */
		participantNumber: p?.number ?? null,
		/** Run-console order per source: what picks the suggested case order from now on. */
		runNumber: p?.runNumber ?? null,
		/** Number the session's suggested order was picked with (older sessions: the overall number). */
		orderNumber: s?.run?.participantNumber ?? s?.study?.participantNumber ?? null,
		orderRow: s?.run?.orderRow ?? s?.study?.orderRow ?? null,
		simRun: s?.sim?.run ?? null
	};
}

type Row = Record<string, unknown>;

/** One trial as a flat CSV row: context first, then every measure (nested values spelled out). */
async function trialRow(t: Doc<'trials'>, j: Joins): Promise<Row> {
	const s = await j.session(t.sessionId);
	const p = await j.participant(t.participantId);
	const b = await j.block(t.blockId);
	const suggested = s?.cueOrder.indexOf(t.cue) ?? -1;
	return {
		trialId: t._id, createdAt: new Date(t.createdAt).toISOString(),
		participantId: t.participantId, ...who(s, p), sessionId: t.sessionId, blockId: t.blockId,
		source: t.source, mode: t.mode, cue: t.cue,
		blockIndex: t.blockIndex, suggestedPosition: suggested >= 0 ? suggested : null,
		pauses: b?.pauses ?? null, pausedSeconds: b?.pausedSeconds ?? null,
		trialIndex: t.trialIndex, difficulty: t.difficulty, level: t.level, mazeId: t.mazeId,
		powerTotal: t.total, sound: t.sound, reducedMotion: t.reducedMotion, inputType: t.inputType, fps: t.fps,
		appVersion: t.appVersion, endReason: t.endReason, leftAtEnd: t.leftAtEnd, scaredAtStart: t.scaredAtStart,
		outcome: t.outcome, rulesVersion: t.rulesVersion ?? 1, engaged: t.engaged, inRates: t.inRates,
		decision: isDecision(t), catchLate: t.outcome === 'catch' ? isLateCatch(t) : null,
		eats: t.eats.length, eatLefts: t.eats.map((e) => e.left).join(' '), lateCatch: t.lateCatch,
		allEatenLeft: t.allEatenLeft, turnLeft: t.turnLeft, turnDist: t.turnDist, turnAt: t.turnAt,
		turnReachable: t.turnReachable, chases: t.chases, lastChaseEnd: t.lastChaseEnd ?? null,
		endDist: t.endDist, endClosing: t.endClosing,
		afterSeen: t.after.seen, afterCut: t.after.cut ?? null, afterDied: t.after.died, caught: t.after.caught,
		timeToCaught: t.after.timeToCaught, killer: t.after.killer, minDangerDist: t.after.minDangerDist,
		nearMiss: t.after.nearMiss, reaction: t.reaction, wasted: t.wasted, diedDuring: t.diedDuring,
		frames: t.frames, hasClip: !!t.clipId, practice: t.practice ?? false
	};
}

async function ratingRow(r: Doc<'ratings'>, j: Joins): Promise<Row> {
	const s = await j.session(r.sessionId);
	const p = await j.participant(r.participantId);
	const b = r.blockId ? await j.block(r.blockId) : null;
	return {
		ratingId: r._id, createdAt: new Date(r.createdAt).toISOString(), kind: r.kind,
		participantId: r.participantId, ...who(s, p), sessionId: r.sessionId, blockId: r.blockId ?? null,
		source: r.source, mode: r.mode, cue: r.cue ?? null, blockIndex: b?.orderIndex ?? null,
		clarity: r.clarity ?? null, distraction: r.distraction ?? null, note: r.note ?? null,
		clearest: r.clearest ?? null, leastClear: r.leastClear ?? null, comment: r.comment ?? null
	};
}

async function blockRow(ctx: QueryCtx, b: Doc<'blocks'>, j: Joins): Promise<Row> {
	const s = await j.session(b.sessionId);
	const p = await j.participant(b.participantId);
	const r = await ctx.db.query('ratings').withIndex('by_block', (i) => i.eq('blockId', b._id)).first();
	const suggested = s?.cueOrder.indexOf(b.cue) ?? -1;
	return {
		blockId: b._id, startedAt: new Date(b.startedAt).toISOString(), endedAt: b.endedAt ? new Date(b.endedAt).toISOString() : null,
		participantId: b.participantId, ...who(s, p), sessionId: b.sessionId,
		source: b.source, mode: b.mode, cue: b.cue, blockIndex: b.orderIndex, suggestedPosition: suggested >= 0 ? suggested : null,
		trials: b.trialCount, engaged: b.engagedCount, deaths: b.deaths, score: b.score,
		pauses: b.pauses ?? null, pausedSeconds: b.pausedSeconds ?? null,
		clarity: r?.clarity ?? null, distraction: r?.distraction ?? null, note: r?.note ?? null,
		appVersion: s?.appVersion ?? null, inputType: s?.inputType ?? null,
		practice: b.practice ?? false, abandoned: b.abandoned ?? false
	};
}

/** The same filter applied to a rating or a block (they carry source, mode, cue, participant and session). */
function matchesRow(r: Doc<'ratings'> | Doc<'blocks'>, f: Filter, at: number, s: Doc<'sessions'> | null): boolean {
	const src = f.source ?? 'human';
	return (src === 'all' || r.source === src)
		&& (!f.mode || r.mode === f.mode)
		&& (!f.cue || r.cue === f.cue)
		&& (!f.participantId || r.participantId === f.participantId)
		&& (!f.sessionId || r.sessionId === f.sessionId)
		&& (!f.run || s?.sim?.run === f.run)
		&& (!!f.includePractice || !('practice' in r && r.practice))
		&& at >= (f.from ?? 0) && at <= (f.to ?? Number.MAX_SAFE_INTEGER);
}

function cell(x: unknown): string {
	if (x === null || x === undefined) return '';
	const s = String(x);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV header line of an export (the columns of every row of that kind, in order). */
export function csvHeader(rows: Row[]): string {
	return Object.keys(rows[0]).map(cell).join(',');
}

/**
 * One page of an export. `rows` are CSV lines (no header; `header` is the header line, the same on
 * every page) or JSON objects. Keep calling with `continueCursor` until `isDone`; a page may hold
 * fewer rows than asked (rows outside the filter are skipped), even none.
 */
export const page = query({
	args: { ...filterArgs, kind, format, paginationOpts: paginationOptsValidator },
	handler: async (ctx, { kind: k, format: fmt, paginationOpts, ...f }) => {
		const j = new Joins(ctx);
		let rows: Row[] = [];
		let res: { isDone: boolean; continueCursor: string };
		if (k === 'trials') {
			const p = await trialRange(ctx, f).paginate(paginationOpts);
			res = p;
			for (const t of p.page) {
				if (!matches(t, f)) continue;
				if (fmt === 'json') {
					const packed = await packedSeriesOf(ctx, t);
					const s = await j.session(t.sessionId);
					const par = await j.participant(t.participantId);
					const b = await j.block(t.blockId);
					rows.push({
						...light(t), ...who(s, par), pauses: b?.pauses ?? null, pausedSeconds: b?.pausedSeconds ?? null,
						rulesVersion: t.rulesVersion ?? 1, decision: isDecision(t), series: packed ? unpackSeries(packed) : null
					});
				} else rows.push(await trialRow(t, j));
			}
		} else if (k === 'ratings') {
			const p = await ctx.db.query('ratings').paginate(paginationOpts);
			res = p;
			for (const r of p.page) {
				if (f.run || !matchesRow(r, f, r.createdAt, null)) {
					if (!f.run || !matchesRow(r, f, r.createdAt, await j.session(r.sessionId))) continue;
				}
				rows.push(await ratingRow(r, j));
			}
		} else {
			// One session: its own index (the whole table may hold thousands of simulated blocks).
			const q = f.sessionId ? ctx.db.query('blocks').withIndex('by_session', (i) => i.eq('sessionId', f.sessionId!)) : ctx.db.query('blocks');
			const p = await q.paginate(paginationOpts);
			res = p;
			for (const b of p.page) {
				if (!matchesRow(b, f, b.startedAt, f.run ? await j.session(b.sessionId) : null)) continue;
				rows.push(await blockRow(ctx, b, j));
			}
		}
		const empty = await emptyRow(ctx, k, fmt);
		if (fmt === 'csv') {
			return { header: csvHeader([rows[0] ?? empty]), rows: rows.map((r) => Object.values(r).map(cell).join(',')), isDone: res.isDone, continueCursor: res.continueCursor };
		}
		return { header: null, rows, isDone: res.isDone, continueCursor: res.continueCursor };
	}
});

/** A row with every column, for the CSV header of an export that has no rows. */
async function emptyRow(ctx: QueryCtx, k: Kind, fmt: 'csv' | 'json'): Promise<Row> {
	if (fmt === 'json') return {};
	const j = new Joins(ctx);
	if (k === 'trials') {
		const t = await ctx.db.query('trials').first();
		return t ? trialRow(t, j) : {};
	}
	if (k === 'ratings') {
		const r = await ctx.db.query('ratings').first();
		return r ? ratingRow(r, j) : {};
	}
	const b = await ctx.db.query('blocks').first();
	return b ? blockRow(ctx, b, j) : {};
}

/** File name of a download: circle-chase-<kind>-<source>[-<run>]-<date>.<format> */
export function fileName(k: Kind, fmt: 'csv' | 'json', f: Filter): string {
	const stamp = new Date().toISOString().slice(0, 10);
	const run = f.run ? `-${f.run.replace(/[^\w-]+/g, '')}` : '';
	return `circle-chase-${k}-${f.source ?? 'human'}${run}-${stamp}.${fmt}`;
}
